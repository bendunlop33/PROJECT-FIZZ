Pod::Spec.new do |s|
  s.name           = 'HealthStore'
  s.version        = '0.1.0'
  s.summary        = 'Apple Health for GymSmarter (ADR 0035): write strength workouts, read workouts and bodyweight'
  s.description    = 'A small HealthKit bridge. Needs the com.apple.developer.healthkit entitlement at runtime; reports when it is missing instead of failing.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
