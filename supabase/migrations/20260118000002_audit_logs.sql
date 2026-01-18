-- Audit Logs Table
-- Records sensitive actions for compliance and security review

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    actor_id UUID,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'customer', 'system', 'admin')),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    resource_type TEXT,
    resource_id TEXT,
    metadata JSONB DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by organization
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON public.audit_logs(organization_id);

-- Index for querying by action type
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);

-- Index for querying by actor
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id, actor_type);

-- Index for time-based queries (most recent first)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- Composite index for common query pattern: org + time
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_time ON public.audit_logs(organization_id, created_at DESC);

-- RLS policies
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only super admins can view all audit logs
CREATE POLICY "Super admins can view all audit logs"
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.auth_id = auth.uid()
            AND users.role = 'super_admin'
        )
    );

-- Organization admins can view their own org's audit logs
CREATE POLICY "Org admins can view their org audit logs"
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public.users
            WHERE users.auth_id = auth.uid()
            AND users.role IN ('org_admin', 'site_admin')
        )
    );

-- Service role can insert audit logs
CREATE POLICY "Service role can insert audit logs"
    ON public.audit_logs
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT INSERT ON public.audit_logs TO service_role;

COMMENT ON TABLE public.audit_logs IS 'Security and compliance audit trail for sensitive actions';
