import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { UltrasonicObservation } from "@confpresence/shared";

type UltrasonicNativeModule = {
  isSupported(): Promise<boolean>;
  startBroadcasting(token: string): Promise<void>;
  stopBroadcasting(): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const nativeModule = NativeModules.ConfPresenceUltrasonic as UltrasonicNativeModule | undefined;

export function isUltrasonicAvailable(): boolean {
  return (Platform.OS === "android" || Platform.OS === "ios") && !!nativeModule;
}

export function requireUltrasonicModule(): UltrasonicNativeModule {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    throw new Error("XConnect Ultrasonic presence supports Android and iOS physical devices.");
  }
  if (!nativeModule) {
    throw new Error("XConnect Ultrasonic native module is not linked. Rebuild the app development client.");
  }
  return nativeModule;
}

export function subscribeToUltrasonicTokens(callback: (observation: UltrasonicObservation) => void) {
  try {
    const module = requireUltrasonicModule();
    const emitter = new NativeEventEmitter(module);
    return emitter.addListener("ConfPresenceUltrasonicDetected", callback);
  } catch {
    return { remove: () => {} };
  }
}
