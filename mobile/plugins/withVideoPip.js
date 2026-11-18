const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withVideoPip(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application[0];
    const name = '.nativemodules.VideoPlayerActivity';
    const activities = application.activity || [];
    let player = activities.find((activity) => activity.$['android:name'] === name);
    if (!player) { player = { $: { 'android:name': name } }; activities.push(player); }
    Object.assign(player.$, {
      'android:exported': 'false',
      'android:enableOnBackInvokedCallback': 'true',
      'android:supportsPictureInPicture': 'true',
      'android:resizeableActivity': 'true',
      'android:screenOrientation': 'unspecified',
      'android:configChanges': 'screenSize|smallestScreenSize|screenLayout|orientation|keyboardHidden|uiMode',
      'android:theme': '@android:style/Theme.Black.NoTitleBar.Fullscreen',
    });
    application.activity = activities;
    return mod;
  });
};
