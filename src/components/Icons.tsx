/**
 * Icon set.
 *
 * Drawn as inline SVG rather than an icon font or PNGs for one reason that matters at this
 * scale: a 1.6pt stroke rendered as vector stays exactly 1.6pt on a 1x, 2x and 3x screen,
 * while a rasterised icon picks up half-pixel blur on one of them. The whole set shares one
 * 24×24 grid, one stroke width and round caps/joins, which is what makes a toolbar read as a
 * set rather than a collection.
 *
 * Geometry follows the dashboard's icons.jsx so the app and the web console show the same
 * marks.
 */
import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type IconProps = {
  size?: number;
  color?: string;
  /** Stroke width in the 24-unit grid, so it scales with `size`. */
  strokeWidth?: number;
};

const DEFAULT_SIZE = 20;
const DEFAULT_STROKE = 1.6;

function Frame({ size = DEFAULT_SIZE, children }: IconProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {children}
    </Svg>
  );
}

/** Shared stroke props so every icon in the set is identical in weight and joinery. */
function stroke(color: string, strokeWidth = DEFAULT_STROKE) {
  return {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

export function IconMonitor({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Rect x={2} y={3} width={20} height={14} rx={2} {...stroke(color, strokeWidth)} />
      <Line x1={8} y1={21} x2={16} y2={21} {...stroke(color, strokeWidth)} />
      <Line x1={12} y1={17} x2={12} y2={21} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconWindows({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Rect x={3} y={3} width={8} height={8} rx={1} {...stroke(color, strokeWidth)} />
      <Rect x={13} y={3} width={8} height={8} rx={1} {...stroke(color, strokeWidth)} />
      <Rect x={3} y={13} width={8} height={8} rx={1} {...stroke(color, strokeWidth)} />
      <Rect x={13} y={13} width={8} height={8} rx={1} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconApple({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M16.5 12.3c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.7-.7-1.4 0-2.7.8-3.4 2.1-1.5 2.6-.4 6.4 1 8.5.7 1 1.6 2.2 2.7 2.1 1.1 0 1.5-.7 2.8-.7 1.3 0 1.6.7 2.7.7 1.1 0 1.9-1.1 2.6-2.1.5-.8.8-1.5.9-1.8-1.6-.6-2.4-2-2.4-4.1Z"
        {...stroke(color, strokeWidth)}
      />
      <Path
        d="M14.4 5.6c.6-.7.9-1.7.8-2.6-.9.1-1.9.6-2.5 1.3-.5.6-1 1.6-.8 2.5 1 .1 1.9-.5 2.5-1.2Z"
        {...stroke(color, strokeWidth)}
      />
    </Frame>
  );
}

export function IconLinux({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M12 2.5c-2 0-3 1.7-3 3.6 0 1.4.2 2.1-.5 3.2-1 1.6-2.4 3.4-2.4 5.4 0 2.4 2.6 4.3 5.9 4.3s5.9-1.9 5.9-4.3c0-2-1.4-3.8-2.4-5.4-.7-1.1-.5-1.8-.5-3.2 0-1.9-1-3.6-3-3.6Z"
        {...stroke(color, strokeWidth)}
      />
      <Circle cx={10.2} cy={7.4} r={0.9} fill={color} />
      <Circle cx={13.8} cy={7.4} r={0.9} fill={color} />
      <Path d="M10.6 10.6c.4.5.9.7 1.4.7s1-.2 1.4-.7" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconX({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Line x1={18} y1={6} x2={6} y2={18} {...stroke(color, strokeWidth)} />
      <Line x1={6} y1={6} x2={18} y2={18} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconChevronRight({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path d="M9 6l6 6-6 6" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconChevronLeft({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path d="M15 6l-6 6 6 6" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconLock({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Rect x={4} y={10.5} width={16} height={10.5} rx={2.5} {...stroke(color, strokeWidth)} />
      <Path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconShield({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M12 2.5l7.5 3v6c0 4.5-3.1 8.3-7.5 10-4.4-1.7-7.5-5.5-7.5-10v-6l7.5-3Z"
        {...stroke(color, strokeWidth)}
      />
      <Path d="M9 12l2.2 2.2L15.5 10" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconPower({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path d="M18.4 6.6a9 9 0 1 1-12.8 0" {...stroke(color, strokeWidth)} />
      <Line x1={12} y1={2} x2={12} y2={12} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconKeyboard({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  const dot = (strokeWidth ?? DEFAULT_STROKE) * 1.6;
  return (
    <Frame size={size}>
      <Rect x={2} y={6} width={20} height={12} rx={2.5} {...stroke(color, strokeWidth)} />
      <Line x1={6} y1={10} x2={6.01} y2={10} {...stroke(color, dot)} />
      <Line x1={10} y1={10} x2={10.01} y2={10} {...stroke(color, dot)} />
      <Line x1={14} y1={10} x2={14.01} y2={10} {...stroke(color, dot)} />
      <Line x1={18} y1={10} x2={18.01} y2={10} {...stroke(color, dot)} />
      <Line x1={7.5} y1={14} x2={16.5} y2={14} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconCursor({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path d="M5 3l14 8.5-6.4 1.4L9.8 19 5 3Z" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconTrackpad({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Rect x={2.5} y={4.5} width={19} height={15} rx={2.5} {...stroke(color, strokeWidth)} />
      <Line x1={2.5} y1={15} x2={21.5} y2={15} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconEye({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"
        {...stroke(color, strokeWidth)}
      />
      <Circle cx={12} cy={12} r={3} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconEyeOff({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path d="M4 5l16 14" {...stroke(color, strokeWidth)} />
      <Path
        d="M9.5 6.2A10.9 10.9 0 0 1 12 5.9c6.4 0 10 6.1 10 6.1a18 18 0 0 1-2.7 3.4"
        {...stroke(color, strokeWidth)}
      />
      <Path
        d="M6.6 8A17.6 17.6 0 0 0 2 12s3.6 6.1 10 6.1c1.2 0 2.3-.2 3.3-.5"
        {...stroke(color, strokeWidth)}
      />
      <Path d="M10.2 10.5a2.6 2.6 0 0 0 3.6 3.6" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconRefresh({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path d="M20 12a8 8 0 1 1-2.6-5.9" {...stroke(color, strokeWidth)} />
      <Path d="M20 4v4h-4" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconSearch({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Circle cx={11} cy={11} r={7} {...stroke(color, strokeWidth)} />
      <Line x1={16.5} y1={16.5} x2={21} y2={21} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconSignOut({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"
        {...stroke(color, strokeWidth)}
      />
      <Path d="M10 8l-4 4 4 4" {...stroke(color, strokeWidth)} />
      <Line x1={6} y1={12} x2={15} y2={12} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconMaximize({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path d="M9 3H4.5A1.5 1.5 0 0 0 3 4.5V9" {...stroke(color, strokeWidth)} />
      <Path d="M15 3h4.5A1.5 1.5 0 0 1 21 4.5V9" {...stroke(color, strokeWidth)} />
      <Path d="M15 21h4.5A1.5 1.5 0 0 0 21 19.5V15" {...stroke(color, strokeWidth)} />
      <Path d="M9 21H4.5A1.5 1.5 0 0 1 3 19.5V15" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconMinimize({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Path d="M3 9h4.5A1.5 1.5 0 0 0 9 7.5V3" {...stroke(color, strokeWidth)} />
      <Path d="M21 9h-4.5A1.5 1.5 0 0 1 15 7.5V3" {...stroke(color, strokeWidth)} />
      <Path d="M21 15h-4.5a1.5 1.5 0 0 0-1.5 1.5V21" {...stroke(color, strokeWidth)} />
      <Path d="M3 15h4.5A1.5 1.5 0 0 1 9 16.5V21" {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconInfo({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  const dot = (strokeWidth ?? DEFAULT_STROKE) * 1.6;
  return (
    <Frame size={size}>
      <Circle cx={12} cy={12} r={9} {...stroke(color, strokeWidth)} />
      <Line x1={12} y1={11} x2={12} y2={16.5} {...stroke(color, strokeWidth)} />
      <Line x1={12} y1={7.8} x2={12.01} y2={7.8} {...stroke(color, dot)} />
    </Frame>
  );
}

export function IconAlert({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  const dot = (strokeWidth ?? DEFAULT_STROKE) * 1.6;
  return (
    <Frame size={size}>
      <Path d="M12 3.5 21 19H3l9-15.5Z" {...stroke(color, strokeWidth)} />
      <Line x1={12} y1={9.5} x2={12} y2={14} {...stroke(color, strokeWidth)} />
      <Line x1={12} y1={16.5} x2={12.01} y2={16.5} {...stroke(color, dot)} />
    </Frame>
  );
}

export function IconScroll({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Rect x={8} y={2.5} width={8} height={19} rx={4} {...stroke(color, strokeWidth)} />
      <Line x1={12} y1={7} x2={12} y2={11} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

export function IconMenu({ size, color = '#a39a8d', strokeWidth }: IconProps) {
  return (
    <Frame size={size}>
      <Line x1={3.5} y1={7} x2={20.5} y2={7} {...stroke(color, strokeWidth)} />
      <Line x1={3.5} y1={12} x2={20.5} y2={12} {...stroke(color, strokeWidth)} />
      <Line x1={3.5} y1={17} x2={14} y2={17} {...stroke(color, strokeWidth)} />
    </Frame>
  );
}

/** platformIcon picks the mark for a device's OS. */
export function platformIcon(platform: 'windows' | 'darwin' | 'linux' | 'unknown') {
  switch (platform) {
    case 'windows':
      return IconWindows;
    case 'darwin':
      return IconApple;
    case 'linux':
      return IconLinux;
    default:
      return IconMonitor;
  }
}
