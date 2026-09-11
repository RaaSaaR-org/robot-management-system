/**
 * @file ActivityTab.tsx
 * @description Activity tab of the robot detail page: send a command, the
 *              command history and the tasks assigned to the robot.
 * @feature robots
 */

import { CommandsTab } from './CommandsTab';
import { TasksTab } from './TasksTab';
import type { ActivityTabProps } from './types';

/** Commands (send + history) above the robot's tasks. */
export function ActivityTab({ tasks, ...commandProps }: ActivityTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <CommandsTab {...commandProps} />
      <TasksTab robot={commandProps.robot} robotId={commandProps.robotId} tasks={tasks} />
    </div>
  );
}
