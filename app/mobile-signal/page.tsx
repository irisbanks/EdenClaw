import type { Metadata } from 'next';
import MobileSignalDashboard from './MobileSignalDashboard';

export const metadata: Metadata = {
  title: 'EDENCLAW Mobile Order Signal',
  description: 'Display-only EDENCLAW signal for orders placed manually by the user on Bitget.',
};

export default function MobileSignalPage() {
  return <MobileSignalDashboard />;
}
