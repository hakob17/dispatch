pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "dispatch-android-demo"
include(":app")
// The SDK straight from source, so the demo always runs the code in this repo
include(":dispatch")
project(":dispatch").projectDir = file("../../packages/android-sdk/dispatch")
