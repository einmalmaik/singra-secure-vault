-- Add subscription permission keys to team_permissions
INSERT INTO team_permissions (permission_key, label, description, category)
VALUES
  (
    'subscriptions.manage',
    'Subscriptions verwalten',
    'Abonnements manuell zuweisen und entziehen',
    'subscriptions'
  ),
  (
    'subscriptions.read',
    'Subscriptions einsehen',
    'Abo-Status eines Nutzers einsehen',
    'subscriptions'
  )
ON CONFLICT (permission_key) DO NOTHING;

-- Grant subscriptions.read to moderator role by default
INSERT INTO role_permissions (role, permission_key)
VALUES ('moderator', 'subscriptions.read')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Grant both to admin role by default
INSERT INTO role_permissions (role, permission_key)
VALUES
  ('admin', 'subscriptions.manage'),
  ('admin', 'subscriptions.read')
ON CONFLICT (role, permission_key) DO NOTHING;
