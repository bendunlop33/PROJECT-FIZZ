Pod::Spec.new do |s|
  s.name           = 'AudioCoach'
  s.version        = '0.1.0'
  s.summary        = 'Owns the iOS audio session for spoken coach cues (PROJECT-FIZZ)'
  s.description    = 'Single owner of AVAudioSession: category and ducking options, AVSpeechSynthesizer cues, interruption and route events, AlarmKit availability.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  # AlarmKit exists only on iOS 26+. Weak-link it so the app still launches on
  # older iOS; every use is behind `#available(iOS 26.0, *)`.
  s.weak_frameworks = 'AlarmKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
