import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Keyboard, ScrollView, TextInput } from 'react-native';

/**
 * Dependency-free stand-in for react-native-keyboard-aware-scroll-view's auto-scroll — that
 * library was pulled because it broke a teammate's build, so this gets the same behavior (a
 * focused field moves clear of the keyboard) from core React Native only.
 *
 * Deliberately does NOT use KeyboardAvoidingView. That works by resizing or repadding its own
 * container, which is fine for a plain full-screen flex:1 layout, but fights a ScrollView that's
 * already height-constrained some other way, a maxHeight bottom sheet in particular: the two end
 * up disagreeing about how tall the scrollable area actually is, which is what made one screen's
 * content stop scrolling into view, push its save button off-screen, and make scrolling feel
 * stuck. Adding the keyboard's own height as extra bottom padding on the ScrollView's *content*
 * sidesteps that entirely — it only ever gives the ScrollView more room to scroll into, it never
 * changes how big anything is laid out, so it works the same whether the ScrollView is full
 * screen or capped inside a modal.
 *
 * Usage: `const { scrollRef, focusHandlerFor, keyboardPadding } = useKeyboardAwareScroll();`,
 * pass `scrollRef` to the ScrollView, merge `{ paddingBottom: keyboardPadding }` into its
 * `contentContainerStyle`, then give each TextInput its own ref plus
 * `onFocus={focusHandlerFor(thatRef)}`. No KeyboardAvoidingView needed anywhere.
 */
export function useKeyboardAwareScroll(topPadding = 24) {
  const scrollRef = useRef<ScrollView>(null);
  // Which field to scroll to once the keyboard is actually up — the keyboard-shown event itself
  // carries no information about which input triggered it.
  const focusedInputRef = useRef<RefObject<TextInput | null> | null>(null);
  const [keyboardPadding, setKeyboardPadding] = useState(0);

  const scrollToFocused = useCallback(() => {
    const input = focusedInputRef.current?.current;
    const scroller = scrollRef.current;
    if (!input || !scroller) return;
    // A short delay: the extra bottom padding this just set needs to actually be committed to
    // layout before there's anything to scroll into, and that's a state update + re-render away
    // even once the keyboard event fires.
    setTimeout(() => {
      // measureLayout is part of NativeMethods on any host-component ref, TextInput included.
      // Passing another component's ref as the "relative to" argument is the standard pattern —
      // React Native resolves it to that component's native node under the hood. The Y this
      // reports is relative to the ScrollView's content, unaffected by how far it's currently
      // scrolled, so it can be passed straight to scrollTo as an absolute target.
      input.measureLayout(
        scroller as unknown as Parameters<TextInput['measureLayout']>[0],
        (_x: number, y: number) => {
          scroller.scrollTo({ y: Math.max(0, y - topPadding), animated: true });
        },
        () => {}
      );
    }, 50);
  }, [topPadding]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardPadding(event.endCoordinates.height);
      scrollToFocused();
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardPadding(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToFocused]);

  const focusHandlerFor = useCallback(
    (inputRef: RefObject<TextInput | null>) => () => {
      focusedInputRef.current = inputRef;
      // The keyboard is already up and settled when focus just moves between fields (tabbing
      // from email to password) — keyboardDidShow won't fire again for that, so this is the only
      // chance to scroll, and it's safe to do immediately since the padding is already in place.
      if (keyboardPadding > 0) scrollToFocused();
    },
    [scrollToFocused, keyboardPadding]
  );

  return { scrollRef, focusHandlerFor, keyboardPadding };
}
