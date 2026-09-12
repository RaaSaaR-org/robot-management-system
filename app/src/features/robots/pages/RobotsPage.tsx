/**
 * @file RobotsPage.tsx
 * @description The robots list, embedded as the "List" tab of FleetPage (which owns the
 *   page header): toolbar, grid or table, register and unregister.
 * @feature robots
 */

import { useState } from 'react';
import { RobotList } from '../components/RobotList';
import { RegisterRobotModal } from '../components/AddRobotDialog';

/** Robots list with its register modal. No PageHeader: FleetPage renders it. */
export function RobotsPage() {
  const [registerOpen, setRegisterOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <RobotList onRegister={() => setRegisterOpen(true)} />
      <RegisterRobotModal isOpen={registerOpen} onClose={() => setRegisterOpen(false)} />
    </div>
  );
}
