import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../features/auth/auth-context';

export function HomeScreen() {
  const { state, signOut } = useAuth();
  if (state.status !== 'signedIn') return null;

  const { user } = state;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.badge}>SIGNED IN</Text>
      <Text style={styles.title}>{name || user.email}</Text>

      <View style={styles.card}>
        <Row label="User ID" value={user.id} />
        <Row label="Email" value={user.email} />
        {user.role ? <Row label="Role" value={String(user.role)} /> : null}
      </View>

      <View style={styles.next}>
        <Text style={styles.nextTitle}>📍 GPS tracking</Text>
        <Text style={styles.nextBody}>
          Auth is wired to the live backend. The location-tracking screen lands
          next — it will POST to /technicians/{user.id}/location.
        </Text>
      </View>

      <Pressable style={styles.signOut} onPress={() => void signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 72,
    backgroundColor: '#0B1220',
  },
  badge: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#131C2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#233149',
    padding: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#233149',
    gap: 16,
  },
  rowLabel: { color: '#9AA5B1', fontSize: 14 },
  rowValue: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  next: {
    backgroundColor: '#111C13',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E3A24',
    padding: 16,
    marginTop: 20,
  },
  nextTitle: { color: '#34D399', fontSize: 15, fontWeight: '700' },
  nextBody: { color: '#9AA5B1', fontSize: 14, marginTop: 6, lineHeight: 20 },
  signOut: {
    marginTop: 'auto',
    paddingTop: 28,
    alignItems: 'center',
  },
  signOutText: { color: '#F97066', fontSize: 16, fontWeight: '600' },
});
