// MediaBubble.tsx — Phase 7 media rendering inside chat bubbles.
//
// Rules obeyed:
// - Download with the logged-in session (RLS applies) → unseal → cache
//   under the app's cacheDirectory keyed by the MESSAGE id → reuse the
//   cache before ANY network call.
// - Undecryptable/tampered media renders as a locked placeholder — never
//   a crash.
// - Images render at envelope aspect ratio (maxWidth 80%, maxHeight ~300);
//   tap → full-screen dark modal viewer, tap again to close.
// - Videos: inline tap-to-play via expo-video inside a viewer modal.
// - Voice: play/pause + scrubber + duration via expo-audio.
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { ChatMessage } from '../lib/messages';
import {
  cacheBytes,
  deleteCachedMedia,
  downloadUnsealedMedia,
  hasCachedMedia,
  readCachedBytes,
} from '../lib/media';
import { colors, fontFamily } from '../theme/theme';

interface MediaBubbleProps {
  item: ChatMessage;
  /** 32-byte conversation key (Phase 7 media key == the text key). */
  conversationKey: Uint8Array;
  maxWidth: number;
}

/** Fit (w, h) inside (maxW, maxH) preserving aspect ratio, never upscale. */
function fit(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(maxW / w, maxH / h, 1);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function MediaBubble({ item, conversationKey, maxWidth }: MediaBubbleProps) {
  if (!item.mediaType || !item.media) {
    return <LockedPlaceholder />;
  }
  if (item.mediaType === 'image') {
    return <ImageMedia item={item} conversationKey={conversationKey} maxWidth={maxWidth} />;
  }
  if (item.mediaType === 'video') {
    return <VideoMedia item={item} conversationKey={conversationKey} maxWidth={maxWidth} />;
  }
  return <VoiceMedia item={item} conversationKey={conversationKey} />;
}

function LockedPlaceholder() {
  return (
    <View style={[styles.mediaBox, styles.lockedBox]}>
      <Ionicons name="lock-closed" size={20} color={colors.textSecondary} />
      <Text style={styles.lockedText}>🔒 Encrypted media</Text>
    </View>
  );
}

/**
 * Shared resolver: cache hit → bytes; miss → download + unseal + cache.
 * `failed` = undecryptable (locked placeholder, never a crash).
 */
function useMediaBytes(
  item: ChatMessage,
  conversationKey: Uint8Array,
  fallbackMime: string,
): { uri: string | null; failed: boolean } {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!item.media) {
          setFailed(true);
          return;
        }
        if (await hasCachedMedia(item.id)) {
          const cached = await readCachedBytes(item.id);
          if (cached) {
            if (!cancelled) {
              setUri(await cacheBytes(item.id, cached, item.media.mimeType ?? fallbackMime));
            }
            return;
          }
        }
        const plain = await downloadUnsealedMedia(item.media.storagePath, conversationKey);
        if (cancelled) {
          return;
        }
        if (!plain) {
          setFailed(true);
          return;
        }
        setUri(await cacheBytes(item.id, plain, item.media.mimeType ?? fallbackMime));
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id, item.media, conversationKey, fallbackMime]);
  return { uri, failed };
}

/** Full-screen dark modal viewer. Tap anywhere to close. */
function Viewer({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewerRoot} onPress={onClose}>
        {children}
      </Pressable>
    </Modal>
  );
}

function ImageMedia({
  item,
  conversationKey,
  maxWidth,
}: {
  item: ChatMessage;
  conversationKey: Uint8Array;
  maxWidth: number;
}) {
  const { uri, failed } = useMediaBytes(item, conversationKey, 'image/jpeg');
  const [open, setOpen] = useState(false);
  const meta = item.media!;
  const box = useMemo(
    () =>
      meta.width && meta.height
        ? fit(meta.width, meta.height, maxWidth, 300)
        : { w: Math.min(240, maxWidth), h: 180 },
    [meta.width, meta.height, maxWidth],
  );

  const content = uri ? (
    <Image
      source={{ uri }}
      style={{ width: box.w, height: box.h, borderRadius: 12 }}
      resizeMode="cover"
    />
  ) : (
    <View style={[styles.mediaBox, { width: box.w, height: box.h }]}>
      {failed ? (
        <Text style={styles.lockedText}>🔒 Cannot decrypt</Text>
      ) : (
        <ActivityIndicator color={colors.textSecondary} />
      )}
    </View>
  );

  return (
    <>
      <Pressable onPress={() => uri && setOpen(true)} disabled={!uri}>
        {content}
      </Pressable>
      <Viewer visible={open} onClose={() => setOpen(false)}>
        <Image
          source={{ uri: uri ?? undefined }}
          style={styles.viewerMedia}
          resizeMode="contain"
        />
      </Viewer>
    </>
  );
}

function VideoMedia({
  item,
  conversationKey,
  maxWidth,
}: {
  item: ChatMessage;
  conversationKey: Uint8Array;
  maxWidth: number;
}) {
  const { uri, failed } = useMediaBytes(item, conversationKey, 'video/mp4');
  const [open, setOpen] = useState(false);
  const meta = item.media!;
  const box = useMemo(
    () =>
      meta.width && meta.height
        ? fit(meta.width, meta.height, maxWidth, 300)
        : { w: Math.min(240, maxWidth), h: 180 },
    [meta.width, meta.height, maxWidth],
  );

  const content = uri ? (
    <View
      style={{
        width: box.w,
        height: box.h,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: colors.surface,
      }}
    >
      <View style={styles.playOverlay} pointerEvents="none">
        <Ionicons name="play-circle" size={44} color={colors.text} />
        <Text style={styles.durationText}>{formatDuration(meta.durationSec ?? 0)}</Text>
      </View>
    </View>
  ) : (
    <View style={[styles.mediaBox, { width: box.w, height: box.h }]}>
      {failed ? (
        <Text style={styles.lockedText}>🔒 Cannot decrypt</Text>
      ) : (
        <ActivityIndicator color={colors.textSecondary} />
      )}
    </View>
  );

  return (
    <>
      <Pressable onPress={() => uri && setOpen(true)} disabled={!uri}>
        {content}
      </Pressable>
      <Viewer visible={open} onClose={() => setOpen(false)}>
        {uri ? <InlineVideoPlayer uri={uri} /> : null}
      </Viewer>
    </>
  );
}

function InlineVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return (
    <VideoView style={styles.viewerMedia} player={player} contentFit="contain" />
  );
}

function VoiceMedia({
  item,
  conversationKey,
}: {
  item: ChatMessage;
  conversationKey: Uint8Array;
}) {
  const { uri, failed } = useMediaBytes(item, conversationKey, 'audio/aac');
  const playerRef = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(item.media?.durationSec ?? 0);
  const trackWidthRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true });
  }, []);

  useEffect(() => {
    if (!uri) {
      return;
    }
    const player = createAudioPlayer({ uri });
    playerRef.current = player;
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.duration > 0) {
        setDuration(status.duration);
      }
      setPosition(status.currentTime);
      setPlaying(status.playing);
    });
    return () => {
      sub.remove();
      player.release();
      playerRef.current = null;
    };
  }, [uri]);

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    if (playing) {
      player.pause();
    } else {
      if (player.currentTime >= duration - 0.05) {
        player.seekTo(0);
      }
      player.play();
    }
  }, [playing, duration]);

  const seekTo = useCallback((ratio: number) => {
    const player = playerRef.current;
    if (!player || duration <= 0) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, ratio));
    setPosition(clamped * duration);
    void player.seekTo(clamped * duration);
  }, [duration]);

  const ratio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  return (
    <View style={[styles.mediaBox, styles.voiceBox]}>
      <Pressable onPress={togglePlay} disabled={!uri}>
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={26}
          color={uri ? colors.text : colors.textSecondary}
        />
      </Pressable>
      <Pressable
        style={styles.scrubberTrack}
        accessibilityLabel="Voice note scrubber"
        onPress={(e) => {
          const w = trackWidthRef.current || trackWidth;
          if (w > 0) {
            seekTo(e.nativeEvent.locationX / w);
          }
        }}
      >
        <View
          onLayout={(e) => {
            trackWidthRef.current = e.nativeEvent.layout.width;
            setTrackWidth(e.nativeEvent.layout.width);
          }}
          style={StyleSheet.absoluteFill}
        >
          <View
            style={[
              styles.scrubberFill,
              { width: `${Math.round(ratio * 100)}%` },
            ]}
          />
          <View
            style={[styles.scrubberThumb, { left: `${Math.round(ratio * 100)}%` }]}
          />
        </View>
      </Pressable>
      <Text style={styles.voiceDuration}>{formatDuration(duration)}</Text>
      {!uri && !failed ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      {failed ? (
        <Text style={styles.lockedText}>🔒</Text>
      ) : null}
    </View>
  );
}

/** Purge a message's local media cache (disappearing media + delete-for-me). */
export async function purgeMediaForMessage(messageId: string): Promise<void> {
  await deleteCachedMedia(messageId);
}

// IMAGE COMPRESSION HELPER shared by the picker flow (ITEM 9).
// Resize to max dimension 1280 and JPEG ~0.7. Size enforcement happens in
// the sender flow (reads the compressed file's size — honest, not faked).
export async function compressImage(
  uri: string,
): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    const out = await manipulateAsync(uri, [{ resize: { width: 1280 } }], {
      compress: 0.7,
      format: SaveFormat.JPEG,
    });
    return { uri: out.uri, width: out.width, height: out.height };
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  mediaBox: {
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedBox: {
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  lockedText: {
    fontSize: 13,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  playOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  durationText: {
    marginTop: 4,
    fontSize: 11,
    fontFamily: fontFamily.medium,
    color: colors.text,
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerMedia: {
    width: '100%',
    height: '80%',
  },
  voiceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignSelf: 'stretch',
    minWidth: 220,
    maxWidth: 260,
  },
  scrubberTrack: {
    flex: 1,
    height: 22,
    justifyContent: 'center',
  },
  scrubberFill: {
    position: 'absolute',
    left: 0,
    top: 9,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
  },
  scrubberThumb: {
    position: 'absolute',
    top: 5,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    backgroundColor: colors.text,
  },
  voiceDuration: {
    fontSize: 12,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    minWidth: 34,
    textAlign: 'right',
  },
});
