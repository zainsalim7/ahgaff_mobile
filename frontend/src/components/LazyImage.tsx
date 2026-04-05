/**
 * LazyImage – performance-optimised image component
 *
 * • Native (iOS / Android): uses expo-image which ships with built-in
 *   memory + disk caching, blurhash placeholder support, and progressive
 *   loading out of the box.
 *
 * • Web: renders a standard <img> with loading="lazy" so the browser
 *   defers off-screen images via the native Intersection Observer, plus
 *   a lightweight blur-up placeholder while the real image loads.
 *
 * Usage:
 *   <LazyImage
 *     source={{ uri: 'https://example.com/photo.jpg' }}
 *     style={{ width: 80, height: 80, borderRadius: 40 }}
 *     placeholder="L6PZfSi_.AyE_3t7t7R**0o#DgR4"   // optional blurhash
 *     alt="Profile photo"
 *   />
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  ViewStyle,
  ImageStyle,
  StyleProp,
  ActivityIndicator,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LazyImageSource {
  uri: string;
}

interface LazyImageProps {
  source: LazyImageSource;
  style?: StyleProp<ImageStyle | ViewStyle>;
  placeholder?: string; // blurhash string (native) or low-res data URI (web)
  alt?: string;
  resizeMode?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  /** Show a spinner while the image loads (default: false) */
  showSpinner?: boolean;
  /** Transition duration in ms (default: 300) */
  transitionDuration?: number;
  /** Called once the image has fully loaded */
  onLoad?: () => void;
  /** Called if the image fails to load */
  onError?: (error: any) => void;
}

// ─── Default blurhash placeholder (neutral grey) ──────────────────────────────
const DEFAULT_BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

// ─── Native implementation (expo-image) ───────────────────────────────────────

function NativeLazyImage({
  source,
  style,
  placeholder = DEFAULT_BLURHASH,
  resizeMode = 'cover',
  transitionDuration = 300,
  showSpinner = false,
  onLoad,
  onError,
}: LazyImageProps) {
  const [loading, setLoading] = useState(true);

  return (
    <View style={[styles.wrapper, style as ViewStyle]}>
      <ExpoImage
        source={source}
        style={StyleSheet.absoluteFill}
        placeholder={placeholder}
        contentFit={resizeMode === 'fill' ? 'fill' : resizeMode === 'contain' ? 'contain' : 'cover'}
        transition={transitionDuration}
        cachePolicy="memory-disk"
        onLoadEnd={() => {
          setLoading(false);
          onLoad?.();
        }}
        onError={(e) => {
          setLoading(false);
          onError?.(e);
        }}
      />
      {showSpinner && loading && (
        <View style={styles.spinnerOverlay}>
          <ActivityIndicator size="small" color="#1565c0" />
        </View>
      )}
    </View>
  );
}

// ─── Web implementation (native <img> with loading="lazy") ────────────────────

function WebLazyImage({
  source,
  style,
  placeholder,
  alt = '',
  resizeMode = 'cover',
  transitionDuration = 300,
  showSpinner = false,
  onLoad,
  onError,
}: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<any>(null);

  // Use IntersectionObserver to trigger load only when near viewport
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const node = containerRef.current;
    if (!node) {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }, // start loading 200 px before entering viewport
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const flatStyle = StyleSheet.flatten(style) as React.CSSProperties & {
    width?: number | string;
    height?: number | string;
    borderRadius?: number;
  };

  const objectFitMap: Record<string, React.CSSProperties['objectFit']> = {
    cover: 'cover',
    contain: 'contain',
    fill: 'fill',
    none: 'none',
    'scale-down': 'scale-down',
  };

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    width: flatStyle?.width ?? '100%',
    height: flatStyle?.height ?? '100%',
    borderRadius: flatStyle?.borderRadius,
    backgroundColor: '#e0e0e0', // placeholder background
  };

  const imgStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: objectFitMap[resizeMode] ?? 'cover',
    opacity: loaded ? 1 : 0,
    transition: `opacity ${transitionDuration}ms ease`,
    display: 'block',
  };

  const placeholderStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundImage: placeholder ? `url(${placeholder})` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(8px)',
    transform: 'scale(1.05)', // hide blur edges
    opacity: loaded ? 0 : 1,
    transition: `opacity ${transitionDuration}ms ease`,
  };

  return (
    // @ts-ignore – ref on a web div via RN View
    <div ref={containerRef} style={containerStyle}>
      {/* Blurred placeholder */}
      {placeholder && <div style={placeholderStyle} />}

      {/* Actual image – only rendered once in viewport */}
      {inView && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source.uri}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={imgStyle}
          onLoad={() => {
            setLoaded(true);
            onLoad?.();
          }}
          onError={(e) => {
            setLoaded(true); // hide placeholder even on error
            onError?.(e);
          }}
        />
      )}

      {/* Optional spinner */}
      {showSpinner && !loaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator size="small" color="#1565c0" />
        </div>
      )}
    </div>
  );
}

// ─── Unified export ───────────────────────────────────────────────────────────

/**
 * Cross-platform lazy-loading image with blur placeholder.
 * Automatically picks the best implementation for the current platform.
 */
export const LazyImage: React.FC<LazyImageProps> = (props) => {
  if (Platform.OS === 'web') {
    return <WebLazyImage {...props} />;
  }
  return <NativeLazyImage {...props} />;
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
    backgroundColor: '#e0e0e0',
  },
  spinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default LazyImage;
