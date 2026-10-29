import os
import sys
import shutil
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ANDROID_DIR = os.path.join(BASE_DIR, "android")
NATIVE_SRC = os.path.join(BASE_DIR, "native-android", "src", "main", "java", "com", "alierenakgul", "mobilmediatoolkit", "nativemodules")
TARGET_DIR = os.path.join(ANDROID_DIR, "app", "src", "main", "java", "com", "alierenakgul", "mobilmediatoolkit", "nativemodules")

def setup_native():
    if not os.path.exists(ANDROID_DIR):
        print("Android directory not found, skipping native injection.")
        return

    # 1. Copy Kotlin native module files
    os.makedirs(TARGET_DIR, exist_ok=True)
    if os.path.exists(NATIVE_SRC):
        for fname in os.listdir(NATIVE_SRC):
            src_file = os.path.join(NATIVE_SRC, fname)
            dst_file = os.path.join(TARGET_DIR, fname)
            if os.path.isfile(src_file):
                shutil.copy2(src_file, dst_file)
                print(f"Copied {fname} -> {dst_file}")

    # 2. Update gradle.properties
    gradle_props = os.path.join(ANDROID_DIR, "gradle.properties")
    if os.path.exists(gradle_props):
        with open(gradle_props, "r", encoding="utf-8") as f:
            props = f.read()

        # Ensure legacy packaging is true
        if "expo.useLegacyPackaging=" in props:
            props = re.sub(r"expo\.useLegacyPackaging=.*", "expo.useLegacyPackaging=true", props)
        else:
            props += "\nexpo.useLegacyPackaging=true\n"

        # Disable minification in release to prevent R8 from stripping native JNI bindings
        if "android.enableMinifyInReleaseBuilds=" in props:
            props = re.sub(r"android\.enableMinifyInReleaseBuilds=.*", "android.enableMinifyInReleaseBuilds=false", props)
        else:
            props += "\nandroid.enableMinifyInReleaseBuilds=false\n"

        with open(gradle_props, "w", encoding="utf-8") as f:
            f.write(props)
        print("Updated gradle.properties (expo.useLegacyPackaging=true, minification=false)")

    # 3. Update app/src/main/AndroidManifest.xml
    manifest_path = os.path.join(ANDROID_DIR, "app", "src", "main", "AndroidManifest.xml")
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = f.read()

        # Add extractNativeLibs, usesCleartextTraffic, requestLegacyExternalStorage to <application
        app_tag_match = re.search(r"<application\b([^>]*)>", manifest)
        if app_tag_match:
            attrs = app_tag_match.group(1)
            new_attrs = attrs
            if 'android:extractNativeLibs=' not in new_attrs:
                new_attrs += ' android:extractNativeLibs="true"'
            else:
                new_attrs = re.sub(r'android:extractNativeLibs="[^"]*"', 'android:extractNativeLibs="true"', new_attrs)

            if 'android:usesCleartextTraffic=' not in new_attrs:
                new_attrs += ' android:usesCleartextTraffic="true"'

            if 'android:requestLegacyExternalStorage=' not in new_attrs:
                new_attrs += ' android:requestLegacyExternalStorage="true"'

            manifest = manifest[:app_tag_match.start(1)] + new_attrs + manifest[app_tag_match.end(1):]
            with open(manifest_path, "w", encoding="utf-8") as f:
                f.write(manifest)
            print("Updated AndroidManifest.xml (<application extractNativeLibs=true usesCleartextTraffic=true>)")

    # 4. Update app/proguard-rules.pro
    proguard_path = os.path.join(ANDROID_DIR, "app", "proguard-rules.pro")
    if os.path.exists(proguard_path):
        with open(proguard_path, "r", encoding="utf-8") as f:
            proguard = f.read()

        keep_rules = """
# youtubedl-android and ffmpeg keep rules
-keep class com.yausername.** { *; }
-keepclassmembers class com.yausername.** { *; }
-keep class io.github.junkfood02.** { *; }
-keepclassmembers class io.github.junkfood02.** { *; }
-dontwarn com.yausername.**
-dontwarn io.github.junkfood02.**
"""
        if "com.yausername" not in proguard:
            proguard += keep_rules
            with open(proguard_path, "w", encoding="utf-8") as f:
                f.write(proguard)
            print("Added youtubedl-android keep rules to proguard-rules.pro")

    # 5. Update app/build.gradle
    build_gradle = os.path.join(ANDROID_DIR, "app", "build.gradle")
    if os.path.exists(build_gradle):
        with open(build_gradle, "r", encoding="utf-8") as f:
            content = f.read()

        dep_line = """
    // Native on-device YouTube downloader engine (Seal / YTDLnis core)
    implementation 'io.github.junkfood02.youtubedl-android:library:0.18.1'
    implementation 'io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1'
"""
        # Replace old version if exists or add
        if "youtubedl-android" in content:
            content = re.sub(r"implementation ['\"]io\.github\.junkfood02\.youtubedl-android:library:[^'\"]*['\"]", "implementation 'io.github.junkfood02.youtubedl-android:library:0.18.1'", content)
            content = re.sub(r"implementation ['\"]io\.github\.junkfood02\.youtubedl-android:ffmpeg:[^'\"]*['\"]", "implementation 'io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1'", content)
        else:
            if "dependencies {" in content:
                content = content.replace("dependencies {", f"dependencies {{\n{dep_line}")
                print("Added youtubedl-android dependencies to build.gradle")

        # Optimize APK size: target arm64-v8a (modern 64-bit Android smartphones)
        # This keeps the APK compact (~48 MB instead of 236 MB)
        abi_line = """
        ndk {
            abiFilters "arm64-v8a"
        }
"""
        if "abiFilters" in content:
            content = re.sub(r'abiFilters\s+["\'][^"\']*["\'](,\s*["\'][^"\']*["\'])*', 'abiFilters "arm64-v8a"', content)
        elif "defaultConfig {" in content:
            content = content.replace("defaultConfig {", f"defaultConfig {{\n{abi_line}")
            print("Added arm64-v8a abiFilters to build.gradle")

        # Explicitly enforce useLegacyPackaging in packagingOptions
        if "useLegacyPackaging" in content:
            content = re.sub(r"useLegacyPackaging\s+.*", "useLegacyPackaging true", content)
        elif "packagingOptions {" in content:
            content = content.replace("packagingOptions {", "packagingOptions {\n        jniLibs {\n            useLegacyPackaging true\n        }")

        # Disable minification in release build to prevent runtime crashes with JNI
        if "minifyEnabled enableMinifyInReleaseBuilds" in content:
            content = content.replace("minifyEnabled enableMinifyInReleaseBuilds", "minifyEnabled false")
        if "shrinkResources enableShrinkResources.toBoolean()" in content:
            content = content.replace("shrinkResources enableShrinkResources.toBoolean()", "shrinkResources false")

        # Enable release signing using debug keystore
        if "signingConfig signingConfigs.release" in content:
            content = content.replace("signingConfig signingConfigs.release", "signingConfig signingConfigs.debug")
        elif "signingConfig signingConfigs.debug" not in content:
            content = content.replace("buildTypes {", "buildTypes {\n        release {\n            signingConfig signingConfigs.debug\n        }")

        with open(build_gradle, "w", encoding="utf-8") as f:
            f.write(content)
        print("Updated app/build.gradle")

    # 6. Register package and initialize in MainApplication.kt
    main_app_path = os.path.join(ANDROID_DIR, "app", "src", "main", "java", "com", "alierenakgul", "mobilmediatoolkit", "MainApplication.kt")
    if os.path.exists(main_app_path):
        with open(main_app_path, "r", encoding="utf-8") as f:
            app_code = f.read()

        import_lines = [
            "import com.alierenakgul.mobilmediatoolkit.nativemodules.YoutubeDLPackage",
            "import com.yausername.youtubedl_android.YoutubeDL",
            "import com.yausername.ffmpeg.FFmpeg",
        ]
        lines = app_code.splitlines()
        new_lines = []
        for line in lines:
            new_lines.append(line)
            if line.startswith("package "):
                for imp in import_lines:
                    if imp not in app_code:
                        new_lines.append(imp)
        app_code = "\n".join(new_lines)

        if "YoutubeDLPackage()" not in app_code:
            if "PackageList(this).packages.apply {" in app_code:
                app_code = app_code.replace("PackageList(this).packages.apply {", "PackageList(this).packages.apply {\n            add(YoutubeDLPackage())")
            elif "PackageList(this).packages" in app_code:
                app_code = app_code.replace("PackageList(this).packages", "PackageList(this).packages.apply { add(YoutubeDLPackage()) }")
            print("Registered YoutubeDLPackage in MainApplication.kt")

        # Initialize YoutubeDL in MainApplication.onCreate()
        if "YoutubeDL.getInstance().init(this)" not in app_code:
            init_code = """
    try {
      YoutubeDL.getInstance().init(this)
    } catch (e: Exception) {
      android.util.Log.e("MainApplication", "YoutubeDL init failed", e)
    }
    try {
      FFmpeg.getInstance().init(this)
    } catch (e: Exception) {
      android.util.Log.e("MainApplication", "FFmpeg init failed", e)
    }
"""
            if "super.onCreate()" in app_code:
                app_code = app_code.replace("super.onCreate()", f"super.onCreate(){init_code}")
                print("Added YoutubeDL.init(this) to MainApplication.onCreate()")

        with open(main_app_path, "w", encoding="utf-8") as f:
            f.write(app_code)

    print("Native setup completed successfully!")

if __name__ == "__main__":
    setup_native()
