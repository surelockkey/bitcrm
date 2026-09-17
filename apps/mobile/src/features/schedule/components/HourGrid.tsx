import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { clientDisplayName, formatSlot, statusTone } from '../../jobs/lib';
import type { Deal } from '../../jobs/types';
import { blockLabel, gridRange, hourLabel, layoutDay } from '../lib';

export interface HourGridProps {
  deals: readonly Deal[];
  onOpenJob: (dealId: string) => void;
  techId?: string;
  /** Pull to refresh, the same gesture the list half of Schedule has. */
  refreshing?: boolean;
  onRefresh?: () => void;
}

/** How tall an hour is. Two lines of text fit, so a short job is still readable. */
export const HOUR_HEIGHT = 72;
/** The gutter the hour labels sit in. */
const GUTTER = 64;

/**
 * The day as an hour grid — the second half of Workiz's Schedule (§4).
 *
 * It answers the one question a list cannot: *where are the gaps*. A
 * technician asked "can you take a 2 o'clock" reads that off a picture in a
 * second and off a list not at all.
 *
 * Three things keep it from being the only way to a job, which it must never
 * be: the Timeline mode beside it is the same day as a list, Home carries the
 * next job on a card, and the jobs that cannot be placed at all — all-day
 * work, and jobs dispatch dated but never timed — are listed above the grid
 * rather than dropped. A screen reader reads all of those in order; it cannot
 * read a position on a canvas.
 */
export function HourGrid({
  deals,
  onOpenJob,
  techId,
  refreshing = false,
  onRefresh,
}: HourGridProps) {
  const { colors, radius, spacing, type } = useTheme();
  const { from, to } = gridRange(deals);
  const { placed, unplaced } = layoutDay(deals, techId);
  const hours = Array.from({ length: to - from }, (_, i) => from + i);

  const toneFill: Record<string, string> = {
    neutral: colors.surface,
    active: colors.primarySoft,
    done: colors.successSoft,
    warning: colors.warningSoft,
    canceled: colors.dangerSoft,
  };

  return (
    <ScrollView
      testID="hour-grid"
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        ) : undefined
      }
    >
      {unplaced.length > 0 ? (
        <View
          testID="hour-grid-untimed"
          style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.xs }}
        >
          <Text style={[type.caption, { color: colors.textMuted }]}>
            No time set
          </Text>
          <View style={[styles.chips, { gap: spacing.sm }]}>
            {unplaced.map((deal) => (
              <Pressable
                key={deal.id}
                testID={`untimed-${deal.id}`}
                accessibilityRole="button"
                accessibilityLabel={blockLabel(deal)}
                accessibilityHint="Opens the job"
                onPress={() => onOpenJob(deal.id)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: toneFill[statusTone(deal.superStatus)],
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[type.label, { color: colors.text }]}>
                  {clientDisplayName(deal) || `Job ${deal.dealNumber}`}
                </Text>
                <Text style={[type.caption, { color: colors.textMuted }]}>
                  {formatSlot(deal.scheduledTimeSlot, deal.allDay)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.canvas, { marginTop: spacing.sm }]}>
        {hours.map((hour) => (
          <View
            key={hour}
            testID={`hour-row-${hour}`}
            style={[styles.hourRow, { height: HOUR_HEIGHT }]}
          >
            <Text
              style={[
                type.caption,
                styles.hourLabel,
                { color: colors.textMuted, width: GUTTER },
              ]}
            >
              {hourLabel(hour)}
            </Text>
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
          </View>
        ))}

        {/* The blocks float over the rules rather than living inside an hour's
            row: a 9:30–11:30 job belongs to no single row. */}
        <View style={[styles.blocks, { left: GUTTER }]} pointerEvents="box-none">
          {placed.map((block) => {
            const top = ((block.startMin - from * 60) / 60) * HOUR_HEIGHT;
            const height = Math.max(
              36,
              ((block.endMin - block.startMin) / 60) * HOUR_HEIGHT - 4,
            );
            const width = `${100 / block.columns}%` as const;
            const left = `${(100 / block.columns) * block.column}%` as const;
            return (
              <Pressable
                key={block.deal.id}
                testID={`grid-job-${block.deal.id}`}
                accessibilityRole="button"
                accessibilityLabel={blockLabel(block.deal)}
                accessibilityHint="Opens the job"
                onPress={() => onOpenJob(block.deal.id)}
                style={({ pressed }) => [
                  styles.block,
                  {
                    top,
                    height,
                    width,
                    left,
                    backgroundColor: toneFill[statusTone(block.deal.superStatus)],
                    borderColor: colors.border,
                    borderRadius: radius.sm,
                    padding: spacing.sm,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[type.label, { color: colors.text }]}
                >
                  {clientDisplayName(block.deal) || `Job ${block.deal.dealNumber}`}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[type.caption, { color: colors.textMuted }]}
                >
                  {formatSlot(block.deal.scheduledTimeSlot, block.deal.allDay)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'relative' },
  hourRow: { flexDirection: 'row', alignItems: 'flex-start' },
  hourLabel: { textAlign: 'right', paddingRight: 8, paddingTop: 2 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, marginTop: 8 },
  blocks: { position: 'absolute', top: 0, right: 8, bottom: 0 },
  block: { position: 'absolute', borderWidth: 1, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { borderWidth: 1 },
});
