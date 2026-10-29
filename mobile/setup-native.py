import os
import sys
import shutil

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

    # 2. Update app/build.gradle
    build_gradle = os.path.join(ANDROID_DIR, "app", "build.gradle")
    if os.path.exists(build_gradle):
        with open(build_gradle, "r", encoding="utf-8") as f:
            content = f.read()

        dep_line = """
    // Native on-device YouTube downloader engine (Seal / YTDLnis core)
    implementation 'io.github.junkfood02.youtubedl-android:library:0.16.0'
    implementation 'io.github.junkfood02.youtubedl-android:ffmpeg:0.16.0'
"""
        if "youtubedl-android" not in content:
            if "dependencies {" in content:
                content = content.replace("dependencies {", f"dependencies {{\n{dep_line}")
                print("Added youtubedl-android dependencies to build.gradle")

        # Ensure abiFilters for arm architectures
        abi_line = """
        ndk {
            abiFilters "arm64-v8a", "armeabi-v7a"
        }
"""
        if "abiFilters" not in content and "defaultConfig {" in content:
            content = content.replace("defaultConfig {", f"defaultConfig {{\n{abi_line}")
            print("Added ARM abiFilters to build.gradle")

        # Allow cleartext HTTP and enable release signing using debug keystore
        if "signingConfig signingConfigs.release" in content:
            content = content.replace("signingConfig signingConfigs.release", "signingConfig signingConfigs.debug")
        elif "signingConfig signingConfigs.debug" not in content:
            content = content.replace("buildTypes {", "buildTypes {\n        release {\n            signingConfig signingConfigs.debug\n        }")

        with open(build_gradle, "w", encoding="utf-8") as f:
            f.write(content)

    # 3. Register package in MainApplication.kt
    main_app_path = os.path.join(ANDROID_DIR, "app", "src", "main", "java", "com", "alierenakgul", "mobilmediatoolkit", "MainApplication.kt")
    if os.path.exists(main_app_path):
        with open(main_app_path, "r", encoding="utf-8") as f:
            app_code = f.read()

        import_line = "import com.alierenakgul.mobilmediatoolkit.nativemodules.YoutubeDLPackage\n"
        if "import com.alierenakgul.mobilmediatoolkit.nativemodules.YoutubeDLPackage" not in app_code:
            lines = app_code.splitlines()
            new_lines = []
            for line in lines:
                new_lines.append(line)
                if line.startswith("package "):
                    new_lines.append(import_line)
            app_code = "\n".join(new_lines)

        if "YoutubeDLPackage()" not in app_code:
            if "PackageList(this).packages.apply {" in app_code:
                app_code = app_code.replace("PackageList(this).packages.apply {", "PackageList(this).packages.apply {\n            add(YoutubeDLPackage())")
            elif "PackageList(this).packages" in app_code:
                app_code = app_code.replace("PackageList(this).packages", "PackageList(this).packages.apply { add(YoutubeDLPackage()) }")
            print("Registered YoutubeDLPackage in MainApplication.kt")

        with open(main_app_path, "w", encoding="utf-8") as f:
            f.write(app_code)

    # 4. Configure AndroidManifest.xml (extractNativeLibs and storage permissions)
    manifest_path = os.path.join(ANDROID_DIR, "app", "src", "main", "AndroidManifest.xml")
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            m_code = f.read()

        if "android:extractNativeLibs" not in m_code:
            m_code = m_code.replace("<application", '<application android:extractNativeLibs="true"')
        if "android:requestLegacyExternalStorage" not in m_code:
            m_code = m_code.replace("<application", '<application android:requestLegacyExternalStorage="true"')

        with open(manifest_path, "w", encoding="utf-8") as f:
            f.write(m_code)

    print("Native setup completed successfully!")

if __name__ == "__main__":
    setup_native()
