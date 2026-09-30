declare module 'react-native-keyboard-aware-scroll-view' {
  import * as React from 'react';
  import { ScrollViewProps } from 'react-native';

  export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
    enableOnAndroid?: boolean;
    enableAutomaticScroll?: boolean;
    extraScrollHeight?: number;
    extraHeight?: number;
    keyboardOpeningTime?: number;
    keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
    contentContainerStyle?: any;
    showsVerticalScrollIndicator?: boolean;
    children?: React.ReactNode;
  }

  export class KeyboardAwareScrollView extends React.Component<KeyboardAwareScrollViewProps> {}
}
