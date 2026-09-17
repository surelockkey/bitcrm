import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Card } from '../../../ui/Card';
import { NOT_CONNECTED, financeFigures, financeSections } from '../mock';

/**
 * The Finance tab of a job card — Workiz's skeleton, reading from nothing.
 *
 * A summary line of our own — Invoice, Total, Balance — over Workiz's five
 * sections in the order §1.4 records them: Job items, Estimates, Invoices,
 * Payments, Documents. Which of those is theirs and which is ours is settled in
 * `mock.ts`, once, where it can be tested. It exists so that wiring the invoice
 * and payment APIs later is a data change rather than a redesign, and so a
 * technician who has used Workiz for years finds the tab where they expect it.
 *
 * Nothing here is tappable. A dead row a technician taps twice a day is worse
 * than an absent one — so the rows say what is not there instead of accepting
 * a tap and answering with a blank screen. The one honest line sits above them
 * all, where it is read before anything else on the tab.
 */
export function FinanceTab() {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <View testID="finance-tab" style={{ gap: spacing.lg }}>
      <View
        testID="finance-not-connected"
        accessibilityLiveRegion="polite"
        style={[
          styles.banner,
          {
            backgroundColor: colors.warningSoft,
            borderColor: colors.warning,
            borderRadius: radius.md,
            padding: spacing.md,
          },
        ]}
      >
        <Text style={[type.body, { color: colors.warning }]}>{NOT_CONNECTED}</Text>
      </View>

      <Card testID="finance-figures">
        <View style={[styles.figures, { gap: spacing.lg }]}>
          {financeFigures().map((figure) => (
            <View key={figure.key} style={styles.figure}>
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {figure.label}
              </Text>
              <Text
                testID={`finance-figure-${figure.key}`}
                style={[type.title, { color: colors.textMuted }]}
              >
                {figure.value}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <View style={{ gap: spacing.md }}>
        {financeSections().map((section) => (
          <Card key={section.key} testID={`finance-section-${section.key}`}>
            <Text style={[type.heading, { color: colors.text }]}>
              {section.label}
            </Text>
            <Text style={[type.body, { color: colors.textMuted }]}>
              {section.empty}
            </Text>
          </Card>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1 },
  figures: { flexDirection: 'row', flexWrap: 'wrap' },
  figure: { gap: 2, flexGrow: 1 },
});
