import { useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '../../lib/api/errors';
import { useTheme } from '../../lib/theme/theme-provider';
import { EmptyState } from '../../ui/EmptyState';
import { Screen, ScreenHeader } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { useMyStock } from './hooks';
import {
  containerSubtitle,
  containerTitle,
  filterStock,
  summaryLine,
} from './lib';
import type { StockRow } from './types';

/**
 * "My stock" — what is on the van, for someone standing at its back door.
 *
 * Workiz has no screen like this. Its help centre documents inventory
 * (locations, containers, stock, transfers) as a **web-only** add-on and says
 * nothing about a van view in the app
 * (`WORKIZ_MOBILE_APP.md` §1.10), so there is no Workiz UX to copy here and
 * the parity rule has nothing to bind. The reference is our own web page,
 * `apps/web/features/tech/components/my-stock-page.tsx`, which is where the
 * order of things on this screen comes from: which van, how much is in it,
 * a search box, then the list. Same endpoints, same meaning, same wording.
 *
 * What is different is the shape, and that is the point of a phone in a van:
 * one column, the quantity large and right-aligned so a thumb never covers
 * it, a search field within reach of that thumb, and no table to scroll
 * sideways. Read-only — stock moves when the office transfers it or the part
 * goes onto a job, and both of those come later.
 */
export function StockScreen() {
  const { colors, radius, spacing, touch, type } = useTheme();
  const { container, rows, summary, unassigned, isLoading, isRefetching, error, stale, refetch } =
    useMyStock();
  const [search, setSearch] = useState('');

  const visible = useMemo(() => filterStock(rows, search), [rows, search]);

  const header = (
    <ScreenHeader
      title="My stock"
      subtitle={container ? containerTitle(container) : undefined}
    />
  );

  if (isLoading) {
    return (
      <Screen testID="stock-screen">
        {header}
        <Splash />
      </Screen>
    );
  }

  // No van is not a failure and there is nothing the technician can do about
  // it from here, so it says who can — and offers no "Try again" that would
  // only fail the same way.
  if (unassigned) {
    return (
      <Screen testID="stock-screen">
        {header}
        <EmptyState
          testID="stock-unassigned"
          title="No van assigned to you yet"
          body="Ask the office to put you on a container. Everything in it shows up here as soon as they do."
        />
      </Screen>
    );
  }

  if (error && rows.length === 0) {
    const offline = error instanceof ApiError && error.status === 0;
    return (
      <Screen testID="stock-screen">
        {header}
        <EmptyState
          testID="stock-error"
          tone="error"
          title={offline ? 'No signal' : 'Could not load your stock'}
          body={
            offline
              ? "Your van's list will appear as soon as the phone has a connection."
              : error instanceof ApiError
                ? error.message
                : 'Something went wrong on the way to the server.'
          }
          actionLabel="Try again"
          onAction={refetch}
        />
      </Screen>
    );
  }

  const subtitle = container ? containerSubtitle(container) : undefined;

  return (
    <Screen testID="stock-screen">
      {header}

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        <Text style={[type.label, { color: colors.textMuted }]} testID="stock-summary">
          {[subtitle, summaryLine(summary)].filter(Boolean).join(' · ')}
        </Text>

        <TextInput
          testID="stock-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search parts"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search my stock"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={[
            type.body,
            styles.search,
            {
              // Same height as any other target in the app: a gloved thumb.
              minHeight: touch.min,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceSunken,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />

        {stale ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.banner,
              {
                backgroundColor: colors.warningSoft,
                borderColor: colors.warning,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              },
            ]}
          >
            <Text style={[type.caption, { color: colors.warning }]}>
              Showing the last list this phone downloaded — it could not reach
              the server just now.
            </Text>
          </View>
        ) : null}
      </View>

      <FlatList
        testID="stock-list"
        data={visible}
        keyExtractor={(row) => row.productId}
        renderItem={({ item }) => <StockLine row={item} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          search ? (
            <EmptyState
              testID="stock-no-match"
              title="Nothing matches"
              body={`No part on the van matches “${search.trim()}”.`}
              actionLabel="Clear search"
              onAction={() => setSearch('')}
            />
          ) : (
            <EmptyState
              testID="stock-empty"
              title="Empty van"
              body="Nothing on your van yet. The office puts stock on it with a transfer."
            />
          )
        }
      />
    </Screen>
  );
}

/**
 * One part. The name wraps rather than truncating — half a part number is
 * worse than two lines — and the quantity keeps its own column so the eye
 * runs straight down it.
 */
function StockLine({ row }: { row: StockRow }) {
  const { colors, radius, spacing, touch, type } = useTheme();
  return (
    <View
      testID="stock-row"
      accessibilityLabel={`${row.name}, ${row.quantity} on the van`}
      style={[
        styles.row,
        {
          minHeight: touch.min,
          gap: spacing.lg,
          padding: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[type.body, styles.name, { color: colors.text }]}>{row.name}</Text>
      <Text
        // Not read aloud on its own: the row's label already says "3 on the
        // van", and a screen reader hitting a bare "3" after the name is noise.
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[type.title, styles.qty, { color: colors.text }]}
      >
        {row.quantity}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  search: { borderWidth: 1 },
  banner: { borderWidth: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: { flexShrink: 1 },
  qty: { fontVariant: ['tabular-nums'] },
});
