---
id: TASK-064
aliases:
- TASK-064
title: ROS 2 Bridge Integration
slug: ros2-bridge-integration
status: backlog
priority: 4
owner: ''
projects: []
customers: []
tags:
- vla
- deferred
sprint: ''
depends_on:
- "[[TASK-051]]"
- "[[TASK-063]]"
due_date: ''
created: 2026-02-19
updated: 2026-02-19
---



# ROS 2 Bridge Integration

## Description
ROS 2 integration für real hardware. **NICHT via rclnodejs** — stattdessen als Python Backend-Plugin in `robot-agent/hardware/backends/ros2_backend.py` via `rclpy` (TASK-079 Plugin System).

`rclpy` + `FollowJointTrajectory` ActionClient ist der native ROS2-Weg und passt direkt in die Hardware Runtime Plugin Architektur. rclnodejs ist deprecated als Ansatz.

## Notes
Migrated from task-master TM-52. Status: deferred.
**Update 2026-02-24:** Architecture changed — rclpy Backend-Plugin statt rclnodejs. Depends on TASK-079 (Plugin system).
depends_on: TASK-079, TASK-051, TASK-063
