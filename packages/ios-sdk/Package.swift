// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DispatchSDK",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        // The app target: identity, events, push handling, message centre, Live Activities, in-app UI
        .library(name: "DispatchSDK", targets: ["DispatchSDK"]),
        // Optional, for a Notification Service Extension: rich images + delivery receipts.
        // Self-contained (no dependency on DispatchSDK) so it stays app-extension safe and tiny.
        .library(name: "DispatchNotificationService", targets: ["DispatchNotificationService"]),
    ],
    targets: [
        .target(name: "DispatchSDK"),
        .target(name: "DispatchNotificationService"),
        .testTarget(name: "DispatchSDKTests", dependencies: ["DispatchSDK", "DispatchNotificationService"]),
    ]
)
