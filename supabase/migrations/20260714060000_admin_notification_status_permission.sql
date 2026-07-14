-- Read-only permission for privacy-preserving notification readiness status.
INSERT INTO public.team_permissions (permission_key, label, description, category)
VALUES (
  'admin.notifications.read',
  'Read Notification Status',
  'View constrained notification readiness signals without recipients, addresses or secret values.',
  'admin'
)
ON CONFLICT (permission_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

INSERT INTO public.role_permissions (role, permission_key)
VALUES ('admin'::public.app_role, 'admin.notifications.read')
ON CONFLICT (role, permission_key) DO NOTHING;
