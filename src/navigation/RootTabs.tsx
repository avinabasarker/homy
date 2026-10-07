import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { ChatsScreen } from '../screens/ChatsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors, fontFamily } from '../theme/theme';

export type RootTabParamList = {
  Chats: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

/** Part C navigation: bottom tab bar with Chats and Settings. */
export function RootTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: fontFamily.medium,
        },
        tabBarIcon: ({ color, size, focused }) => {
          const name =
            route.name === 'Chats'
              ? focused
                ? 'chatbubbles'
                : 'chatbubbles-outline'
              : focused
                ? 'settings'
                : 'settings-outline';
          return <Ionicons name={name} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Chats" component={ChatsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
