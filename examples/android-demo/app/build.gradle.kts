import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Written by `npm run demo -- setup` (repo root): server URL as the emulator sees it + SDK key
@Suppress("UNCHECKED_CAST")
val demoConfig: Map<String, Any?> = rootDir.resolve("../demo-config.json").let { f ->
    if (f.exists()) JsonSlurper().parse(f) as Map<String, Any?> else emptyMap()
}
fun cfg(key: String, fallback: String) = "\"${demoConfig[key] as? String ?: fallback}\""

android {
    namespace = "com.dispatch.demo"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dispatch.demo"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "demo-1.0"
        buildConfigField("String", "DISPATCH_BASE_URL", cfg("androidBaseUrl", "http://10.0.2.2:3000"))
        buildConfigField("String", "DISPATCH_SDK_KEY", cfg("sdkKey", ""))
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(project(":dispatch"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material:material-icons-core")
}
