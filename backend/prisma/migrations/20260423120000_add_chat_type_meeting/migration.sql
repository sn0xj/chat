-- Add `meeting` chat type for conversation-based meeting rooms.
ALTER TABLE `Chat`
  MODIFY `type` ENUM('private', 'group', 'meeting') NOT NULL;
