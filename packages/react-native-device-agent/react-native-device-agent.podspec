require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name = "react-native-device-agent"
  s.version = package["version"]
  s.summary = package["description"]
  s.description = package["description"]
  s.homepage = "https://github.com/openai/device-agent"
  s.license = package["license"]
  s.author = "OpenAI"
  s.platform = :ios, "13.0"
  s.source = { :path => "." }
  s.source_files = "ios/**/*.{swift,h,m}"
  s.swift_version = "5.0"
  s.dependency "React-Core"
end
