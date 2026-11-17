const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withShareReceiver(config) {
  return withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity.$['android:launchMode'] = 'singleTask';
    const filters = activity['intent-filter'] || [];
    if (!filters.some((filter) => filter.action?.some((action) => action.$['android:name'] === 'android.intent.action.SEND'))) {
      filters.push({
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': 'text/plain' } }],
      });
    }
    activity['intent-filter'] = filters;
    return mod;
  });
};
