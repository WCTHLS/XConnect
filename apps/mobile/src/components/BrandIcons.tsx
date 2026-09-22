import Svg, { Path, Rect } from "react-native-svg";

export function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.8741 2.6836-6.615z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.806.5404-1.8368.8591-3.0477.8591-2.3436 0-4.3282-1.5831-5.036-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" />
      <Path fill="#FBBC05" d="M3.964 10.71c-.18-.5404-.2822-1.1177-.2822-1.71s.1023-1.1696.2823-1.71V4.9582H.9573A8.9965 8.9965 0 000 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z" />
      <Path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.43 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6564 3.5795 9 3.5795z" />
    </Svg>
  );
}

export function MicrosoftLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 21 21">
      <Rect x={1} y={1} width={9} height={9} fill="#F25022" />
      <Rect x={11} y={1} width={9} height={9} fill="#7FBA00" />
      <Rect x={1} y={11} width={9} height={9} fill="#00A4EF" />
      <Rect x={11} y={11} width={9} height={9} fill="#FFB900" />
    </Svg>
  );
}
