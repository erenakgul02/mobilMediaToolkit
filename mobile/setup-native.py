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

    # 2. Update gradle.properties (compressed native libs for lightweight ~15-20MB APK)
    gradle_props = os.path.join(ANDROID_DIR, "gradle.properties")
    if os.path.exists(gradle_props):
        with open(gradle_props, "r", encoding="utf-8") as f:
            props = f.read()

        if "expo.useLegacyPackaging=" in props:
            props = re.sub(r"expo\.useLegacyPackaging=.*", "expo.useLegacyPackaging=false", props)
        else:
            props += "\nexpo.useLegacyPackaging=false\n"

        if "android.enableMinifyInReleaseBuilds=" in props:
            props = re.sub(r"android\.enableMinifyInReleaseBuilds=.*", "android.enableMinifyInReleaseBuilds=false", props)
        else:
            props += "\nandroid.enableMinifyInReleaseBuilds=false\n"

        # Exclude duplicate META-INF files coming from NewPipeExtractor / jsoup / rhino
        excludes_Line = "android.packagingOptions.excludes=META-INF/README.md,META-INF/CHANGES,META-INF/COPYRIGHT,META-INF/DEPENDENCIES,META-INF/INDEX.LIST,META-INF/LICENSE,META-INF/LICENSE.txt,META-INF/NOTICE,META-INF/NOTICE.txt"
        if "android.packagingOptions.excludes=" not in props:
            props += f"\n{excludes_Line}\n"

        with open(gradle_props, "w", encoding="utf-8") as f:
            f.write(props)
        print("Updated gradle.properties (useLegacyPackaging=false, minification=false, packaging excludes)")

    # 3. Add JitPack repository to root build.gradle and settings.gradle
    root_gradle = os.path.join(ANDROID_DIR, "build.gradle")
    if os.path.exists(root_gradle):
        with open(root_gradle, "r", encoding="utf-8") as f:
            rg = f.read()
        if "jitpack.io" not in rg:
            rg = rg.replace(
                "allprojects {\n  repositories {",
                "allprojects {\n  repositories {\n    maven { url 'https://www.jitpack.io' }"
            )
            if "jitpack.io" not in rg and "mavenCentral()" in rg:
                rg = rg.replace("mavenCentral()", "mavenCentral()\n        maven { url 'https://www.jitpack.io' }")
            with open(root_gradle, "w", encoding="utf-8") as f:
                f.write(rg)
            print("Added JitPack repository to android/build.gradle")

    settings_gradle = os.path.join(ANDROID_DIR, "settings.gradle")
    if os.path.exists(settings_gradle):
        with open(settings_gradle, "r", encoding="utf-8") as f:
            sg = f.read()
        if "jitpack.io" not in sg and "repositories {" in sg:
            sg = sg.replace("repositories {", "repositories {\n        maven { url 'https://www.jitpack.io' }")
            with open(settings_gradle, "w", encoding="utf-8") as f:
                f.write(sg)
            print("Added JitPack repository to android/settings.gradle")

    # 4. Update app/src/main/AndroidManifest.xml
    manifest_path = os.path.join(ANDROID_DIR, "app", "src", "main", "AndroidManifest.xml")
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = f.read()

        # Add permissions required for background audio playback & media notifications
        required_perms = [
            "android.permission.FOREGROUND_SERVICE",
            "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
            "android.permission.WAKE_LOCK",
            "android.permission.POST_NOTIFICATIONS",
            "android.permission.ACCESS_NETWORK_STATE",
            "android.permission.MODIFY_AUDIO_SETTINGS",
            "android.permission.WRITE_SETTINGS",
        ]
        for perm in required_perms:
            if perm not in manifest:
                manifest = manifest.replace(
                    "<application",
                    f'  <uses-permission android:name="{perm}" />\n  <application',
                    1
                )

        app_tag_match = re.search(r"<application\b([^>]*)>", manifest)
        if app_tag_match:
            attrs = app_tag_match.group(1)
            new_attrs = attrs
            if 'android:usesCleartextTraffic=' in new_attrs:
                new_attrs = re.sub(r'android:usesCleartextTraffic="[^"]*"', 'android:usesCleartextTraffic="false"', new_attrs)
            else:
                new_attrs += ' android:usesCleartextTraffic="false"'
            if 'android:requestLegacyExternalStorage=' not in new_attrs:
                new_attrs += ' android:requestLegacyExternalStorage="true"'

            manifest = manifest[:app_tag_match.start(1)] + new_attrs + manifest[app_tag_match.end(1):]

        # Create res/xml/mediatoolkit_file_paths.xml restricted strictly to MediaToolkit & Ringtones directories (no <root-path>)
        xml_dir = os.path.join(ANDROID_DIR, "app", "src", "main", "res", "xml")
        os.makedirs(xml_dir, exist_ok=True)
        file_paths_xml = os.path.join(xml_dir, "mediatoolkit_file_paths.xml")
        with open(file_paths_xml, "w", encoding="utf-8") as xf:
            xf.write("""<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="mediatoolkit_downloads" path="Download/MediaToolkit" />
    <external-path name="mediatoolkit_ringtones" path="Ringtones" />
    <external-files-path name="app_external_files" path="." />
    <files-path name="internal_files" path="MediaToolkit" />
    <cache-path name="cache_files" path="." />
</paths>
""")

        # Register MusicPlayerService and unrestricted MediaToolkit FileProvider
        service_decl = """    <service
      android:name=".nativemodules.MusicPlayerService"
      android:enabled="true"
      android:exported="false"
      android:foregroundServiceType="mediaPlayback" />
    <provider
      android:name="androidx.core.content.FileProvider"
      android:authorities="${applicationId}.mediatoolkit.provider"
      android:exported="false"
      android:grantUriPermissions="true">
      <meta-data
        android:name="android.support.FILE_PROVIDER_PATHS"
        android:resource="@xml/mediatoolkit_file_paths" />
    </provider>
  </application>"""
        if "MusicPlayerService" not in manifest and "</application>" in manifest:
            manifest = manifest.replace("</application>", service_decl, 1)

        with open(manifest_path, "w", encoding="utf-8") as f:
            f.write(manifest)
        print("Updated AndroidManifest.xml (permissions + MusicPlayerService + FileProvider)")

    # 5. Update app/proguard-rules.pro
    proguard_path = os.path.join(ANDROID_DIR, "app", "proguard-rules.pro")
    if os.path.exists(proguard_path):
        with open(proguard_path, "r", encoding="utf-8") as f:
            proguard = f.read()

        keep_rules = """
# NewPipeExtractor & Rhino keep rules
-keep class org.schabi.newpipe.** { *; }
-keepclassmembers class org.schabi.newpipe.** { *; }
-keep class org.mozilla.** { *; }
-dontwarn org.mozilla.**
-dontwarn javax.annotation.**
"""
        if "org.schabi.newpipe" not in proguard:
            proguard += keep_rules
            with open(proguard_path, "w", encoding="utf-8") as f:
                f.write(proguard)
            print("Added NewPipeExtractor keep rules to proguard-rules.pro")

    # 6. Update app/build.gradle
    build_gradle = os.path.join(ANDROID_DIR, "app", "build.gradle")
    if os.path.exists(build_gradle):
        with open(build_gradle, "r", encoding="utf-8") as f:
            content = f.read()

        # Remove old heavy youtubedl-android dependencies if present
        content = re.sub(r".*youtubedl-android.*\n?", "", content)

        dep_line = """
    // Lightweight pure-Java YouTube extractor engine (NewPipeExtractor v0.27.1, no Python/FFmpeg bloat)
    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.1.5'
    implementation('com.github.TeamNewPipe:NewPipeExtractor:v0.27.1') {
        exclude group: 'com.google.code.findbugs', module: 'jsr305'
    }
"""
        if "NewPipeExtractor" not in content and "dependencies {" in content:
            content = content.replace("dependencies {", f"dependencies {{\n{dep_line}")
            print("Added NewPipeExtractor v0.27.1 + desugar_jdk_libs_nio to app/build.gradle")

        # Enable coreLibraryDesugaringEnabled in android block
        desugar_block = """
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
        coreLibraryDesugaringEnabled true
    }
"""
        if "coreLibraryDesugaringEnabled" not in content and "defaultConfig {" in content:
            content = content.replace("defaultConfig {", f"{desugar_block}\n    defaultConfig {{")
            print("Enabled coreLibraryDesugaring in app/build.gradle")

        # Support both arm64-v8a (phones) and x86_64 (BlueStacks / PC emulators)
        abi_line = """
        ndk {
            abiFilters "arm64-v8a", "x86_64"
        }
"""
        if "abiFilters" in content:
            content = re.sub(r'abiFilters\s+["\'][^"\']*["\'](,\s*["\'][^"\']*["\'])*', 'abiFilters "arm64-v8a", "x86_64"', content)
        elif "defaultConfig {" in content:
            content = content.replace("defaultConfig {", f"defaultConfig {{\n{abi_line}")
            print("Added arm64-v8a and x86_64 abiFilters to build.gradle")

        # Disable minification in release build
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

    # 7. Register YoutubeDLPackage in MainApplication.kt
    main_app_path = os.path.join(ANDROID_DIR, "app", "src", "main", "java", "com", "alierenakgul", "mobilmediatoolkit", "MainApplication.kt")
    if os.path.exists(main_app_path):
        with open(main_app_path, "r", encoding="utf-8") as f:
            app_code = f.read()

        # Clean up any old youtubedl-android imports/calls if re-run
        app_code = re.sub(r"import com\.yausername\..*\n?", "", app_code)

        pkg_import = "import com.alierenakgul.mobilmediatoolkit.nativemodules.YoutubeDLPackage"
        if pkg_import not in app_code:
            lines = app_code.splitlines()
            new_lines = []
            for line in lines:
                new_lines.append(line)
                if line.startswith("package "):
                    new_lines.append(pkg_import)
            app_code = "\n".join(new_lines)

        if "YoutubeDLPackage()" not in app_code:
            if "PackageList(this).packages.apply {" in app_code:
                app_code = app_code.replace(
                    "PackageList(this).packages.apply {",
                    "PackageList(this).packages.apply {\n            add(YoutubeDLPackage())"
                )
            elif "PackageList(this).packages" in app_code:
                app_code = app_code.replace(
                    "PackageList(this).packages",
                    "PackageList(this).packages.apply { add(YoutubeDLPackage()) }"
                )
            print("Registered YoutubeDLPackage in MainApplication.kt")

        with open(main_app_path, "w", encoding="utf-8") as f:
            f.write(app_code)

    print("Native setup (NewPipeExtractor v0.27.1) completed successfully!")

if __name__ == "__main__":
    setup_native()
