import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextField } from '../components/TextField';
import { PrimaryButton } from '../components/PrimaryButton';
import { useSocialGraph } from '../hooks/useSocialGraph';
import type { AddFriendResult } from '../lib/social';
import { useAuth } from '../state/AuthProvider';
import { colors, fontFamily, spacing } from '../theme/theme';

function formatLastSeen(lastSeen: string | null, online: boolean): string {
  if (online) {
    return 'Online';
  }
  if (!lastSeen) {
    return 'Offline';
  }
  const date = new Date(lastSeen);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) {
    return 'Last seen just now';
  }
  if (mins < 60) {
    return `Last seen ${mins} min ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `Last seen ${hours} h ago`;
  }
  return `Last seen ${date.toDateString()}`;
}

function PresenceDot({ online }: { online: boolean }) {
  return <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />;
}

export function ChatsScreen() {
  const { userId } = useAuth();
  const { loading, refreshing, requests, contacts, error, accept, remove, addFriend, refresh } =
    useSocialGraph(userId);
  const insets = useSafeAreaInsets();

  const [showAddForm, setShowAddForm] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addMessage, setAddMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const incoming = requests.filter((r) => r.direction === 'incoming');
  const outgoing = requests.filter((r) => r.direction === 'outgoing');

  const handleAddFriend = async () => {
    if (!addUsername.trim()) {
      return;
    }
    setAdding(true);
    setAddMessage(null);
    try {
      const result = await addFriend(addUsername);
      handleAddResult(result);
    } finally {
      setAdding(false);
    }
  };

  const handleAddResult = (result: AddFriendResult) => {
    if (result.kind === 'sent') {
      setAddMessage({ tone: 'ok', text: 'Request sent!' });
      setAddUsername('');
    } else {
      setAddMessage({ tone: 'error', text: result.message });
    }
  };

  const rows = [
    // self-chat entry always available (Part B Phase 3)
    { key: 'row-self' as const },
    ...incoming.map((r) => ({ key: `row-in-${r.id}` as const, request: r, incoming: true })),
    ...outgoing.map((r) => ({ key: `row-out-${r.id}` as const, request: r, incoming: false })),
    ...contacts.map((c) => ({ key: `row-c-${c.userId}` as const, contact: c })),
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.headerTitle}>Chats</Text>
        <Pressable
          accessibilityLabel="Add friend"
          onPress={() => {
            setShowAddForm((v) => !v);
            setAddMessage(null);
          }}
          style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed]}
        >
          <Text style={styles.plusText}>{showAddForm ? '×' : '+'}</Text>
        </Pressable>
      </View>

      {showAddForm ? (
        <View style={styles.addForm}>
          <TextField
            label="Add by exact username"
            value={addUsername}
            onChangeText={setAddUsername}
            placeholder="e.g. alice_test"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <PrimaryButton
            label="Send request"
            onPress={handleAddFriend}
            loading={adding}
            disabled={addUsername.trim().length === 0}
          />
          {addMessage ? (
            <Text
              style={
                addMessage.tone === 'ok' ? styles.addMessageOk : styles.addMessageError
              }
            >
              {addMessage.text}
            </Text>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.key}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>No messages yet. Say Hi!</Text>
          }
          renderItem={({ item }) => {
            if (item.key === 'row-self') {
              return (
                <View style={styles.row}>
                  <View style={styles.avatarSelf}>
                    <Text style={styles.avatarSelfText}>
                      {userId ? (userId[0] ?? '?').toUpperCase() : '?'}
                    </Text>
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>Saved messages (you)</Text>
                    <Text style={styles.rowSub}>A private chat with yourself</Text>
                  </View>
                  <PresenceDot online={true} />
                </View>
              );
            }
            if ('request' in item && item.request) {
              const r = item.request;
              const isIn = item.incoming;
              return (
                <View style={styles.row}>
                  <View style={styles.avatarLetter}>
                    <Text style={styles.avatarLetterText}>
                      {(r.otherUsername[0] ?? '?').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>{r.otherUsername}</Text>
                    <Text style={styles.rowSub}>
                      {isIn ? 'Wants to be your contact' : 'Request sent — waiting'}
                    </Text>
                  </View>
                  {isIn ? (
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityLabel={`Accept request from ${r.otherUsername}`}
                        onPress={() => void accept(r.id)}
                        style={[styles.actionBtn, styles.acceptBtn]}
                      >
                        <Text style={[styles.actionText, styles.acceptText]}>Accept</Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`Reject request from ${r.otherUsername}`}
                        onPress={() => void remove(r.id)}
                        style={[styles.actionBtn, styles.rejectBtn]}
                      >
                        <Text style={[styles.actionText, styles.rejectText]}>Reject</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityLabel={`Withdraw request to ${r.otherUsername}`}
                      onPress={() => void remove(r.id)}
                      style={[styles.actionBtn, styles.rejectBtn]}
                    >
                      <Text style={[styles.actionText, styles.rejectText]}>Cancel</Text>
                    </Pressable>
                  )}
                </View>
              );
            }
            if ('contact' in item && item.contact) {
              const c = item.contact;
              return (
                <View style={styles.row}>
                  <View style={styles.avatarLetter}>
                    <Text style={styles.avatarLetterText}>
                      {(c.username[0] ?? '?').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>{c.username}</Text>
                    <Text style={styles.rowSub}>{formatLastSeen(c.lastSeen, c.online)}</Text>
                  </View>
                  <PresenceDot online={c.online} />
                </View>
              );
            }
            return null;
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
  plusButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  plusPressed: {
    opacity: 0.7,
  },
  plusText: {
    color: colors.accent,
    fontSize: 20,
    fontFamily: fontFamily.semiBold,
    marginTop: -2,
  },
  addForm: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addMessageOk: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  addMessageError: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: '#B84A4A',
  },
  errorBanner: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: '#B84A4A',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 48,
    textAlign: 'center',
    fontSize: 15,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 16,
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
  rowSub: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  avatarSelf: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSelfText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: fontFamily.semiBold,
  },
  avatarLetter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.silhouette,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetterText: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fontFamily.semiBold,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotOnline: {
    backgroundColor: colors.accent,
  },
  dotOffline: {
    backgroundColor: colors.border,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionBtn: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 64,
    alignItems: 'center',
  },
  acceptBtn: {
    backgroundColor: colors.accent,
  },
  acceptText: {
    color: '#FFFFFF',
  },
  rejectBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rejectText: {
    color: colors.textSecondary,
  },
  actionText: {
    fontSize: 13,
    fontFamily: fontFamily.semiBold,
  },
});
