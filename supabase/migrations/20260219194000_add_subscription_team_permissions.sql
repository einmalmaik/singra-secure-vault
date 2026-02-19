-- ============================================
-- Add subscription permissions for internal team
-- ============================================

INSERT INTO public.team_permissions (permission_key, label, description, category)
VALUES
    ('subscriptions.read', 'Read Subscriptions', 'View user subscription status in admin support tools.', 'subscriptions'),
    ('subscriptions.manage', 'Manage Subscriptions', 'Manually assign or revoke subscription tiers for users.', 'subscriptions')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key)
VALUES
    ('admin', 'subscriptions.read'),
    ('admin', 'subscriptions.manage'),
    ('moderator', 'subscriptions.read')
ON CONFLICT (role, permission_key) DO NOTHING;
