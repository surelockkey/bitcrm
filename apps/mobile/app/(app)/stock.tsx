import { router } from 'expo-router';
import { StockScreen } from '../../src/features/inventory/stock-screen';

/**
 * `bitcrm://stock` — Menu → My stock.
 *
 * A tab until the bar was cut to Workiz's three. Pushed over them now, so Back
 * returns to whichever tab the technician opened the menu from.
 */
export default function StockRoute() {
  return (
    <StockScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}
