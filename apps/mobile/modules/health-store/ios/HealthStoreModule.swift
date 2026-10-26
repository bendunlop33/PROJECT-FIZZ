import ExpoModulesCore
import HealthKit

// Apple Health (Ben, 27 Oct 2026; ADR 0035; docs/design/apple-health.md).
//
// A deliberately small HealthKit bridge. JS decides what to write and what a read means
// (packages/domain/src/health.ts); this file only talks to HealthKit:
//  - capability(): is Health on this device, and does this install carry the entitlement?
//    SideStore's re-signing may strip com.apple.developer.healthkit; HealthKit then fails with
//    "Missing com.apple.developer.healthkit entitlement". That is reported as `missing`, never thrown.
//  - requestAuthorization(share, read): the iOS sheet, only when Ben turns a switch on.
//  - saveWorkout(...): one HKWorkout (strength type, start, end, pause/resume events) with
//    HKMetadataKeySyncIdentifier/SyncVersion and HKMetadataKeyExternalUUID = the session ID. Before
//    saving it looks for this app's sample with the same sync identifier: one at this version or newer
//    is adopted, not written again (a retry after a force-close writes nothing twice). No energy,
//    heart rate, distance or set data (rule 6).
//  - deleteWorkout(uuid), deleteAllOwnWorkouts(): only this app's own samples can be deleted.
//  - readWorkouts(since, until, heartRate), readBodyMass(since): plain values with their source.
//
// Written without a Mac: first compiled by the macOS CI build (as the other local modules were).

private enum HealthBridgeError: Error {
  case unavailable
}

public class HealthStoreModule: Module {
  private lazy var store = HKHealthStore()

  private static func isMissingEntitlement(_ error: Error) -> Bool {
    let text = (error as NSError).localizedDescription.lowercased()
    return text.contains("entitlement")
  }

  private static func objectType(_ name: String) -> HKObjectType? {
    switch name {
    case "workout": return HKObjectType.workoutType()
    case "bodyMass": return HKQuantityType.quantityType(forIdentifier: .bodyMass)
    case "heartRate": return HKQuantityType.quantityType(forIdentifier: .heartRate)
    case "distanceWalkingRunning": return HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
    case "distanceCycling": return HKQuantityType.quantityType(forIdentifier: .distanceCycling)
    case "distanceSwimming": return HKQuantityType.quantityType(forIdentifier: .distanceSwimming)
    default: return nil
    }
  }

  private static func ms(_ date: Date) -> Double { date.timeIntervalSince1970 * 1000 }
  private static func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

  public func definition() -> ModuleDefinition {
    Name("HealthStore")

    Constants([
      "bundleId": Bundle.main.bundleIdentifier ?? ""
    ])

    // { status: 'available' | 'unsupported' | 'missing_entitlement' | 'unknown', message }
    AsyncFunction("capability") { () async -> [String: Any] in
      guard HKHealthStore.isHealthDataAvailable() else {
        return ["status": "unsupported", "message": "Health data isn't available on this device"]
      }
      let type = HKObjectType.workoutType()
      return await withCheckedContinuation { cont in
        self.store.getRequestStatusForAuthorization(toShare: [type], read: [type]) { _, error in
          if let error = error {
            let missing = HealthStoreModule.isMissingEntitlement(error)
            cont.resume(returning: ["status": missing ? "missing_entitlement" : "unknown", "message": (error as NSError).localizedDescription])
          } else {
            cont.resume(returning: ["status": "available", "message": ""])
          }
        }
      }
    }

    // Shows the iOS sheet for the types not asked yet. Resolves { ok, message }: `ok` means the sheet
    // finished, not that Ben allowed anything (iOS never says whether a read was allowed).
    AsyncFunction("requestAuthorization") { (share: [String], read: [String]) async -> [String: Any] in
      guard HKHealthStore.isHealthDataAvailable() else { return ["ok": false, "message": "unsupported"] }
      let shareTypes = Set(share.compactMap { HealthStoreModule.objectType($0) as? HKSampleType })
      let readTypes = Set(read.compactMap { HealthStoreModule.objectType($0) })
      do {
        try await self.store.requestAuthorization(toShare: shareTypes, read: readTypes)
        return ["ok": true, "message": ""]
      } catch {
        let missing = HealthStoreModule.isMissingEntitlement(error)
        return ["ok": false, "message": missing ? "missing_entitlement" : (error as NSError).localizedDescription]
      }
    }

    // 'notDetermined' | 'denied' | 'authorized' for writing workouts (only share status is knowable).
    AsyncFunction("workoutShareStatus") { () -> String in
      guard HKHealthStore.isHealthDataAvailable() else { return "denied" }
      switch self.store.authorizationStatus(for: HKObjectType.workoutType()) {
      case .sharingAuthorized: return "authorized"
      case .sharingDenied: return "denied"
      default: return "notDetermined"
      }
    }

    // { uuid, adopted }
    AsyncFunction("saveWorkout") { (input: [String: Any]) async throws -> [String: Any] in
      guard HKHealthStore.isHealthDataAvailable() else { throw HealthBridgeError.unavailable }
      let rawType = (input["activityType"] as? NSNumber)?.uintValue ?? HKWorkoutActivityType.traditionalStrengthTraining.rawValue
      let start = HealthStoreModule.date((input["startMs"] as? NSNumber)?.doubleValue ?? 0)
      let end = HealthStoreModule.date((input["endMs"] as? NSNumber)?.doubleValue ?? 0)
      let syncId = input["syncIdentifier"] as? String ?? ""
      let syncVersion = (input["syncVersion"] as? NSNumber)?.intValue ?? 1
      let externalId = input["externalId"] as? String ?? ""
      let timeZone = input["timeZone"] as? String ?? TimeZone.current.identifier
      let pauses = (input["pauses"] as? [[String: Any]]) ?? []

      // Already written at this version or newer (a retry after a force-close): adopt it.
      if let existing = try await self.ownWorkout(syncIdentifier: syncId),
        let version = existing.metadata?[HKMetadataKeySyncVersion] as? NSNumber, version.intValue >= syncVersion {
        return ["uuid": existing.uuid.uuidString, "adopted": true]
      }

      let configuration = HKWorkoutConfiguration()
      configuration.activityType = HKWorkoutActivityType(rawValue: rawType) ?? .traditionalStrengthTraining
      configuration.locationType = .indoor
      let builder = HKWorkoutBuilder(healthStore: self.store, configuration: configuration, device: .local())
      try await builder.beginCollection(at: start)
      var events: [HKWorkoutEvent] = []
      for p in pauses {
        let ps = HealthStoreModule.date((p["startMs"] as? NSNumber)?.doubleValue ?? 0)
        let pe = HealthStoreModule.date((p["endMs"] as? NSNumber)?.doubleValue ?? 0)
        guard pe > ps, ps >= start, pe <= end else { continue }
        events.append(HKWorkoutEvent(type: .pause, dateInterval: DateInterval(start: ps, duration: 0), metadata: nil))
        events.append(HKWorkoutEvent(type: .resume, dateInterval: DateInterval(start: pe, duration: 0), metadata: nil))
      }
      if !events.isEmpty { try await builder.addWorkoutEvents(events) }
      try await builder.addMetadata([
        HKMetadataKeySyncIdentifier: syncId,
        HKMetadataKeySyncVersion: NSNumber(value: syncVersion),
        HKMetadataKeyExternalUUID: externalId,
        HKMetadataKeyTimeZone: timeZone,
        HKMetadataKeyIndoorWorkout: true,
      ])
      try await builder.endCollection(at: end)
      guard let workout = try await builder.finishWorkout() else {
        throw NSError(domain: "HealthStore", code: 1, userInfo: [NSLocalizedDescriptionKey: "Health didn't return the workout"])
      }
      return ["uuid": workout.uuid.uuidString, "adopted": false]
    }

    // Deletes one of this app's workouts. Resolves the number deleted (0: already gone).
    AsyncFunction("deleteWorkout") { (uuid: String) async throws -> Int in
      guard let id = UUID(uuidString: uuid) else { return 0 }
      let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
        HKQuery.predicateForObject(with: id),
        HKQuery.predicateForObjects(from: HKSource.default()),
      ])
      return try await self.deleteWorkouts(predicate)
    }

    // `Remove GymSmarter workouts from Health`: every workout this app wrote, nothing else.
    AsyncFunction("deleteAllOwnWorkouts") { () async throws -> Int in
      try await self.deleteWorkouts(HKQuery.predicateForObjects(from: HKSource.default()))
    }

    AsyncFunction("readWorkouts") { (sinceMs: Double, untilMs: Double, heartRate: Bool) async throws -> [[String: Any]] in
      let predicate = HKQuery.predicateForSamples(withStart: HealthStoreModule.date(sinceMs), end: HealthStoreModule.date(untilMs), options: [])
      let samples = try await self.query(HKObjectType.workoutType(), predicate: predicate)
      var out: [[String: Any]] = []
      for case let w as HKWorkout in samples {
        var row: [String: Any] = [
          "uuid": w.uuid.uuidString,
          "activityType": w.workoutActivityType.rawValue,
          "startMs": HealthStoreModule.ms(w.startDate),
          "endMs": HealthStoreModule.ms(w.endDate),
          "durationS": w.duration,
          "sourceName": w.sourceRevision.source.name,
          "sourceBundleId": w.sourceRevision.source.bundleIdentifier,
          "externalId": (w.metadata?[HKMetadataKeyExternalUUID] as? String) ?? NSNull(),
          "timeZone": (w.metadata?[HKMetadataKeyTimeZone] as? String) ?? NSNull(),
        ]
        row["distanceM"] = HealthStoreModule.distance(of: w) ?? NSNull()
        if heartRate, let hr = await self.heartRate(of: w) {
          row["avgHeartRate"] = hr.avg ?? NSNull()
          row["maxHeartRate"] = hr.max ?? NSNull()
        } else {
          row["avgHeartRate"] = NSNull()
          row["maxHeartRate"] = NSNull()
        }
        out.append(row)
      }
      return out
    }

    AsyncFunction("readBodyMass") { (sinceMs: Double) async throws -> [[String: Any]] in
      guard let type = HKQuantityType.quantityType(forIdentifier: .bodyMass) else { return [] }
      let predicate = HKQuery.predicateForSamples(withStart: HealthStoreModule.date(sinceMs), end: nil, options: [])
      let samples = try await self.query(type, predicate: predicate)
      return samples.compactMap { s -> [String: Any]? in
        guard let q = s as? HKQuantitySample else { return nil }
        return [
          "uuid": q.uuid.uuidString,
          "kg": q.quantity.doubleValue(for: .gramUnit(with: .kilo)),
          "atMs": HealthStoreModule.ms(q.startDate),
          "sourceName": q.sourceRevision.source.name,
          "sourceBundleId": q.sourceRevision.source.bundleIdentifier,
        ]
      }
    }
  }

  // MARK: - Helpers

  private func query(_ type: HKSampleType, predicate: NSPredicate?) async throws -> [HKSample] {
    try await withCheckedThrowingContinuation { cont in
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
      let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
        if let error = error { cont.resume(throwing: error) } else { cont.resume(returning: samples ?? []) }
      }
      self.store.execute(q)
    }
  }

  private func ownWorkout(syncIdentifier: String) async throws -> HKWorkout? {
    guard !syncIdentifier.isEmpty else { return nil }
    let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
      HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [syncIdentifier]),
      HKQuery.predicateForObjects(from: HKSource.default()),
    ])
    return try await query(HKObjectType.workoutType(), predicate: predicate).last as? HKWorkout
  }

  private func deleteWorkouts(_ predicate: NSPredicate) async throws -> Int {
    try await withCheckedThrowingContinuation { cont in
      self.store.deleteObjects(of: HKObjectType.workoutType(), predicate: predicate) { _, count, error in
        if let error = error { cont.resume(throwing: error) } else { cont.resume(returning: count) }
      }
    }
  }

  private static func distance(of w: HKWorkout) -> Double? {
    let ids: [HKQuantityTypeIdentifier] = [.distanceWalkingRunning, .distanceCycling, .distanceSwimming]
    for id in ids {
      if let type = HKQuantityType.quantityType(forIdentifier: id), let sum = w.statistics(for: type)?.sumQuantity() {
        return sum.doubleValue(for: .meter())
      }
    }
    return nil
  }

  /// Average and maximum heart rate the workout's own source recorded during it (nil when Health has none).
  private func heartRate(of w: HKWorkout) async -> (avg: Double?, max: Double?)? {
    guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return nil }
    let bpm = HKUnit.count().unitDivided(by: .minute())
    if let stats = w.statistics(for: type), stats.averageQuantity() != nil || stats.maximumQuantity() != nil {
      return (stats.averageQuantity()?.doubleValue(for: bpm), stats.maximumQuantity()?.doubleValue(for: bpm))
    }
    let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
      HKQuery.predicateForSamples(withStart: w.startDate, end: w.endDate, options: .strictStartDate),
      HKQuery.predicateForObjects(from: w.sourceRevision.source),
    ])
    return await withCheckedContinuation { cont in
      let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: [.discreteAverage, .discreteMax]) { _, stats, _ in
        guard let stats = stats else {
          cont.resume(returning: nil)
          return
        }
        cont.resume(returning: (stats.averageQuantity()?.doubleValue(for: bpm), stats.maximumQuantity()?.doubleValue(for: bpm)))
      }
      self.store.execute(q)
    }
  }
}
