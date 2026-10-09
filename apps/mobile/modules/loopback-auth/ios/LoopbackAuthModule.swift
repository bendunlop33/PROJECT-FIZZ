import AuthenticationServices
import ExpoModulesCore
import Network
import UIKit

// Spike S1 (docs/research/ai-access-and-voice.md, option A; ADR 0012).
//
// "Sign in with ChatGPT" for local apps redirects to an HTTP loopback address,
// http://127.0.0.1:<port>/auth/callback, with no custom-scheme option. This
// module:
//  1. listens on 127.0.0.1 only (Network.framework NWListener; no entitlement,
//     loopback is not "local network"), preferring port 1455, else any port;
//  2. opens the authorize URL in ASWebAuthenticationSession with a callback
//     scheme that is never used, so the sheet can only end by Cancel, by our
//     timeout, or by the listener receiving the redirect;
//  3. when GET <path> arrives, answers with a small page, closes the sheet and
//     resolves openAuthSession with the full callback URL.
//
// The query string (code, state) goes only to JS, never into the log.
// While the sheet is open the module holds a background task, so a short
// switch to another app (e.g. for a 2FA code) doesn't suspend the listener
// straight away; if the listener still fails, it re-listens once on the same
// port (the redirect URI's port can't change mid-attempt).
//
// Written without a Mac: first compiled by the macOS CI build. All state is
// main-queue only (functions run on .main; NW callbacks use .main).

private final class AuthPresentationAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    return windows.first(where: { $0.isKeyWindow }) ?? windows.first ?? ASPresentationAnchor()
  }
}

public class LoopbackAuthModule: Module {
  /// Never redirected to: the sheet must not complete by itself.
  private static let unusedCallbackScheme = "fizz-loopback-unused"
  private static let maxRequestBytes = 16 * 1024
  private static let maxLogEntries = 100
  /// A listener that never becomes ready (stuck in .waiting) fails the start instead of hanging (review S7).
  private static let startTimeoutSeconds: Double = 10

  private var listener: NWListener?
  private var listenerPort: UInt16 = 0
  private var callbackPath = "/auth/callback"
  private var connections: [ObjectIdentifier: NWConnection] = [:]
  private var relistenAttempted = false

  private var authSession: ASWebAuthenticationSession?
  private var pendingAuth: Promise?
  private var timeoutWork: DispatchWorkItem?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private let anchor = AuthPresentationAnchor()

  private var log: [[String: Any]] = []

  public func definition() -> ModuleDefinition {
    Name("LoopbackAuth")

    OnDestroy {
      DispatchQueue.main.async { [weak self] in
        self?.finishAuth(["outcome": "error", "message": "The sign-in module was unloaded"])
        self?.stopListening(reason: "module unloaded")
      }
    }

    /// Resolves { port } once listening on 127.0.0.1. Restarts if already listening.
    AsyncFunction("startListener") { (path: String, preferredPort: Int, promise: Promise) in
      self.finishAuth(["outcome": "error", "message": "A new sign-in attempt started"])
      self.stopListening(reason: "restarted")
      self.log = []
      self.relistenAttempted = false
      self.callbackPath = path
      self.listen(port: preferredPort, fallbackToAny: true, promise: promise)
    }.runOnQueue(.main)

    /// Resolves { outcome: "callback", url } | { outcome: "cancelled" | "timeout" } | { outcome: "error", message }.
    AsyncFunction("openAuthSession") { (urlString: String, timeoutMs: Double, ephemeral: Bool, promise: Promise) in
      guard self.pendingAuth == nil else {
        promise.reject("ERR_BUSY", "A sign-in sheet is already open")
        return
      }
      guard let url = URL(string: urlString), url.scheme == "https" else {
        promise.reject("ERR_URL", "The sign-in address must be https")
        return
      }
      guard self.listener != nil, self.listenerPort != 0 else {
        promise.reject("ERR_NO_LISTENER", "Start the loopback listener first")
        return
      }
      let session = ASWebAuthenticationSession(url: url, callbackURLScheme: LoopbackAuthModule.unusedCallbackScheme) { [weak self] callbackURL, error in
        DispatchQueue.main.async {
          self?.sessionEnded(callbackURL: callbackURL, error: error)
        }
      }
      session.presentationContextProvider = self.anchor
      session.prefersEphemeralWebBrowserSession = ephemeral
      self.pendingAuth = promise
      self.authSession = session
      self.record("sheet", "opening (ephemeral: \(ephemeral))")
      guard session.start() else {
        self.authSession = nil
        self.pendingAuth = nil
        self.record("sheet", "could not start")
        promise.reject("ERR_SHEET", "The sign-in sheet could not open")
        return
      }
      self.beginBackgroundTask()
      let work = DispatchWorkItem { [weak self] in
        self?.finishAuth(["outcome": "timeout"])
      }
      self.timeoutWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + max(1, timeoutMs) / 1000, execute: work)
    }.runOnQueue(.main)

    /// Closes the sheet; a pending openAuthSession resolves "cancelled".
    AsyncFunction("cancelAuthSession") {
      self.finishAuth(["outcome": "cancelled"])
    }.runOnQueue(.main)

    AsyncFunction("stopListener") {
      self.stopListening(reason: "stopped by app")
    }.runOnQueue(.main)

    /// Diagnostics since the last startListener: [{ atMs, kind, detail }]. Never contains the query.
    AsyncFunction("getLog") { () -> [[String: Any]] in
      return self.log
    }.runOnQueue(.main)
  }

  // MARK: - Listener

  private func listen(port: Int, fallbackToAny: Bool, promise: Promise?) {
    let requested: NWEndpoint.Port = (1...65535).contains(port) ? (NWEndpoint.Port(rawValue: UInt16(port)) ?? .any) : .any
    let parameters = NWParameters.tcp
    // Bind to the IPv4 loopback address only: nothing off the phone can connect.
    parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: requested)
    parameters.allowLocalEndpointReuse = true

    let newListener: NWListener
    do {
      newListener = try NWListener(using: parameters)
    } catch {
      record("error", "could not create listener on port \(requested.rawValue): \(error.localizedDescription)")
      if fallbackToAny && requested != .any {
        listen(port: 0, fallbackToAny: false, promise: promise)
      } else {
        failStart(promise, message: "Could not listen on 127.0.0.1: \(error.localizedDescription)")
      }
      return
    }

    var settled = false
    // Never leave startListener (or a re-listen during sign-in) pending forever.
    let startTimeout = DispatchWorkItem { [weak self, weak newListener] in
      guard let self, !settled else { return }
      settled = true
      self.record("error", "listener did not become ready within \(Int(LoopbackAuthModule.startTimeoutSeconds)) s")
      if let newListener {
        newListener.cancel()
        if self.listener === newListener {
          self.listener = nil
        }
      }
      self.failStart(promise, message: "The loopback listener didn't start in time")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + LoopbackAuthModule.startTimeoutSeconds, execute: startTimeout)
    newListener.stateUpdateHandler = { [weak self, weak newListener] state in
      guard let self, let newListener else { return }
      switch state {
      case .ready:
        let actual = newListener.port?.rawValue ?? 0
        self.listenerPort = actual
        self.record("ready", "listening on 127.0.0.1:\(actual)")
        startTimeout.cancel()
        if !settled {
          settled = true
          promise?.resolve(["port": Int(actual)])
        }
      case .waiting(let error):
        self.record("error", "listener waiting: \(error.localizedDescription)")
      case .failed(let error):
        self.record("error", "listener failed: \(error.localizedDescription)")
        newListener.cancel()
        if self.listener === newListener {
          self.listener = nil
        }
        if !settled {
          settled = true
          startTimeout.cancel()
          if fallbackToAny && requested != .any {
            self.listen(port: 0, fallbackToAny: false, promise: promise)
          } else {
            self.failStart(promise, message: "Could not listen on 127.0.0.1: \(error.localizedDescription)")
          }
        } else if self.pendingAuth != nil {
          self.relistenDuringSignIn()
        }
      case .cancelled:
        self.record("stopped", "listener stopped")
      default:
        break
      }
    }
    newListener.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    listener = newListener
    newListener.start(queue: .main)
  }

  /// A start that can't succeed: reject startListener, or, for the re-listen
  /// during sign-in (no promise), end the sign-in now instead of waiting for
  /// the 5-minute timeout (review S7).
  private func failStart(_ promise: Promise?, message: String) {
    if let promise {
      promise.reject("ERR_LISTENER", message)
    } else if pendingAuth != nil {
      finishAuth(["outcome": "error", "message": "The loopback listener stopped during sign-in"])
    }
  }

  /// The redirect URI's port is fixed for this attempt: re-listen on it once.
  private func relistenDuringSignIn() {
    guard !relistenAttempted, listenerPort != 0 else {
      finishAuth(["outcome": "error", "message": "The loopback listener stopped during sign-in"])
      return
    }
    relistenAttempted = true
    record("ready", "re-listening on the same port after a failure")
    listen(port: Int(listenerPort), fallbackToAny: false, promise: nil)
  }

  private func stopListening(reason: String) {
    for connection in connections.values {
      connection.cancel()
    }
    connections.removeAll()
    if let current = listener {
      listener = nil
      current.cancel()
      record("stopped", reason)
    }
    listenerPort = 0
  }

  // MARK: - Connections

  private func accept(_ connection: NWConnection) {
    let id = ObjectIdentifier(connection)
    connections[id] = connection
    record("connection", "from \(LoopbackAuthModule.describe(connection.endpoint))")
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed(let error):
        self?.record("error", "connection failed: \(error.localizedDescription)")
        connection.cancel()
      case .cancelled:
        self?.connections.removeValue(forKey: id)
      default:
        break
      }
    }
    connection.start(queue: .main)
    receive(connection, buffer: Data())
  }

  private func receive(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: LoopbackAuthModule.maxRequestBytes) { [weak self] data, _, isComplete, error in
      guard let self else {
        connection.cancel()
        return
      }
      var accumulated = buffer
      if let data {
        accumulated.append(data)
      }
      if let end = accumulated.range(of: Data("\r\n\r\n".utf8)) {
        self.handleRequest(connection, head: accumulated.subdata(in: accumulated.startIndex..<end.lowerBound))
        return
      }
      if error != nil || isComplete || accumulated.count > LoopbackAuthModule.maxRequestBytes {
        self.record("error", "request ended before its headers were complete")
        connection.cancel()
        return
      }
      self.receive(connection, buffer: accumulated)
    }
  }

  private func handleRequest(_ connection: NWConnection, head: Data) {
    let text = String(decoding: head, as: UTF8.self)
    let requestLine = text.components(separatedBy: "\r\n").first ?? ""
    let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
    guard parts.count >= 2 else {
      record("not_found", "malformed request line")
      respond(connection, status: "400 Bad Request", title: "Bad request", message: "")
      return
    }
    let method = String(parts[0])
    let target = String(parts[1])
    let path = target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? target
    record("request", "\(method) \(path)")

    guard method == "GET", path == callbackPath else {
      record("not_found", "\(method) \(path) is not the callback path")
      respond(connection, status: "404 Not Found", title: "Not found", message: "")
      return
    }
    guard pendingAuth != nil else {
      record("callback", "callback arrived with no sign-in waiting; ignored")
      respond(connection, status: "200 OK", title: "Nothing to do", message: "You can close this page and return to Fizz.")
      return
    }
    record("callback", "GET \(path) received (query passed to the app, not logged)")
    respond(connection, status: "200 OK", title: "Back to Fizz", message: "Sign-in reply received. This page closes by itself.")
    finishAuth(["outcome": "callback", "url": "http://127.0.0.1:\(listenerPort)\(target)"])
  }

  private func respond(_ connection: NWConnection, status: String, title: String, message: String) {
    let body = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>\(title)</title></head>"
      + "<body style=\"font-family:-apple-system,sans-serif;padding:24px\"><h2>\(title)</h2><p>\(message)</p></body></html>"
    let bodyData = Data(body.utf8)
    let headers = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(bodyData.count)\r\n"
      + "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n"
    var payload = Data(headers.utf8)
    payload.append(bodyData)
    connection.send(content: payload, completion: .contentProcessed { _ in
      connection.cancel()
    })
  }

  // MARK: - Auth session

  private func sessionEnded(callbackURL: URL?, error: Error?) {
    // Already finished by the listener, the timeout or cancelAuthSession.
    guard pendingAuth != nil else { return }
    if let callbackURL {
      finishAuth(["outcome": "callback", "url": callbackURL.absoluteString])
      return
    }
    if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
      finishAuth(["outcome": "cancelled"])
      return
    }
    finishAuth(["outcome": "error", "message": error?.localizedDescription ?? "The sign-in sheet closed"])
  }

  /// Settles the pending sheet once and closes it. Safe to call repeatedly.
  private func finishAuth(_ result: [String: Any]) {
    timeoutWork?.cancel()
    timeoutWork = nil
    guard let promise = pendingAuth else { return }
    pendingAuth = nil
    let session = authSession
    authSession = nil
    // Dismisses the sheet; its completion then finds nothing pending.
    session?.cancel()
    record("sheet", "closed: \(result["outcome"] as? String ?? "?")")
    endBackgroundTask()
    promise.resolve(result)
  }

  private func beginBackgroundTask() {
    endBackgroundTask()
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Fizz ChatGPT sign-in") { [weak self] in
      self?.record("error", "background time ran out while signing in")
      self?.endBackgroundTask()
    }
  }

  private func endBackgroundTask() {
    if backgroundTask != .invalid {
      UIApplication.shared.endBackgroundTask(backgroundTask)
      backgroundTask = .invalid
    }
  }

  // MARK: - Log

  private func record(_ kind: String, _ detail: String) {
    log.append(["atMs": Date().timeIntervalSince1970 * 1000, "kind": kind, "detail": detail])
    if log.count > LoopbackAuthModule.maxLogEntries {
      log.removeFirst(log.count - LoopbackAuthModule.maxLogEntries)
    }
  }

  private static func describe(_ endpoint: NWEndpoint) -> String {
    switch endpoint {
    case .hostPort(let host, _):
      return "\(host)"
    default:
      return "\(endpoint)"
    }
  }
}
