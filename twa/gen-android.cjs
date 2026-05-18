#!/usr/bin/env node
// Generates a minimal Android TWA project for Flota PWA
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, 'android')
const APP = path.join(OUT, 'app')
const MAIN = path.join(APP, 'src', 'main')
const RES = path.join(MAIN, 'res')
const JAVA = path.join(MAIN, 'java', 'com', 'flota', 'app')
const GRADLE = path.join(OUT, 'gradle', 'wrapper')

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  console.log('✓', path.relative(OUT, p))
}

// settings.gradle — formato moderno Gradle 8.x
write(path.join(OUT, 'settings.gradle'), `pluginManagement {
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
rootProject.name = 'Flota'
include ':app'
`)

// root build.gradle — declara plugin sin aplicarlo
write(path.join(OUT, 'build.gradle'), `plugins {
    id 'com.android.application' version '8.3.2' apply false
}
`)

// gradle.properties
write(path.join(OUT, 'gradle.properties'), `android.useAndroidX=true
android.enableJetifier=true
org.gradle.jvmargs=-Xmx2048m
`)

// app/build.gradle
write(path.join(APP, 'build.gradle'), `plugins { id 'com.android.application' }
android {
    namespace 'com.flota.app'
    compileSdk 34
    defaultConfig {
        applicationId 'com.flota.app'
        minSdk 21
        targetSdk 34
        versionCode 1
        versionName '1.0'
        manifestPlaceholders = [
            hostName        : 'flota-v2.vercel.app',
            defaultUrl      : 'https://flota-v2.vercel.app/',
            launcherName    : 'Flota',
            themeColor      : '#0a0a0a',
            navigationColor : '#0a0a0a',
            backgroundColor : '#0a0a0a',
        ]
    }
    signingConfigs {
        release {
            storeFile     rootProject.file(System.getenv('KEYSTORE_PATH') ?: '../android-key.keystore')
            storePassword (System.getenv('KEYSTORE_PASSWORD') ?: 'flotaapp2024')
            keyAlias      'flota'
            keyPassword   (System.getenv('KEY_PASSWORD') ?: 'flotaapp2024')
        }
    }
    buildTypes {
        release {
            minifyEnabled false
            signingConfig signingConfigs.release
        }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
}
dependencies {
    implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.5.0'
    implementation 'androidx.appcompat:appcompat:1.6.1'
}
`)

// AndroidManifest.xml
write(path.join(MAIN, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:name="com.flota.app.TwaActivity"
            android:exported="true"
            android:theme="@style/AppTheme">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="https" android:host="\${hostName}"/>
            </intent-filter>
        </activity>

        <service
            android:name="com.google.androidbrowserhelper.trusted.DelegationService"
            android:enabled="true"
            android:exported="true">
            <intent-filter>
                <action android:name="android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE"/>
                <category android:name="android.intent.category.DEFAULT"/>
            </intent-filter>
        </service>

        <meta-data
            android:name="asset_statements"
            android:resource="@string/asset_statements"/>
    </application>
</manifest>
`)

// TwaActivity.java — nombre distinto al padre para evitar herencia circular
write(path.join(JAVA, 'TwaActivity.java'), `package com.flota.app;
public class TwaActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {}
`)

// strings.xml
write(path.join(RES, 'values', 'strings.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Flota</string>
    <string name="asset_statements">
        [{
            \\"relation\\": [\\"delegate_permission/common.handle_all_urls\\"],
            \\"target\\": {
                \\"namespace\\": \\"web\\",
                \\"site\\": \\"https://flota-v2.vercel.app\\"
            }
        }]
    </string>
</resources>
`)

// colors.xml
write(path.join(RES, 'values', 'colors.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#0a0a0a</color>
    <color name="colorPrimaryDark">#0a0a0a</color>
    <color name="colorAccent">#276EF1</color>
    <color name="backgroundColor">#0a0a0a</color>
</resources>
`)

// styles.xml
write(path.join(RES, 'values', 'styles.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.NoActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
        <item name="android:windowBackground">@color/backgroundColor</item>
    </style>
</resources>
`)

// gradle wrapper properties
write(path.join(GRADLE, 'gradle-wrapper.properties'), `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.6-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`)

console.log('\n✅ Android TWA project generated in twa/android/')
console.log('   Build with: cd twa/android && ./gradlew assembleRelease')
