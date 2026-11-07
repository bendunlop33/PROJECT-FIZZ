Pod::Spec.new do |s|
  s.name           = 'LoopbackAuth'
  s.version        = '0.1.0'
  s.summary        = 'Loopback (127.0.0.1) OAuth redirect listener plus ASWebAuthenticationSession (PROJECT-FIZZ spike S1)'
  s.description    = 'Receives the http://127.0.0.1:<port>/auth/callback redirect used by Sign in with ChatGPT for local apps, inside the app, while the system auth sheet is open. No entitlements.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network', 'AuthenticationServices'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
