import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sky.browser',
  appName: 'Sky Browser',
  webDir: 'src',
  android: {
    allowMixedContent: true
  }
};

export default config;
