// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Vault Health Page
 *
 * Premium feature: Analyzes all vault passwords and displays
 * a comprehensive health report with score, categories, and
 * actionable recommendations.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Shield,
    ShieldAlert,
    ShieldCheck,
    AlertTriangle,
    Copy,
    Clock,
    RefreshCw,
    ArrowLeft,
    Loader2,
    ChevronRight,
    Lock,
    Download,
    ChevronDown,
    Database,
    Fingerprint,
    User,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { FeatureGate } from '@/components/Subscription/FeatureGate';
import { useAuth } from '@/contexts/AuthContext';
import { useVault } from '@/contexts/VaultContext';
import {
    analyzeVaultHealth,
    type HealthReport,
    type HealthIssue,
    type HealthIssueType,
} from '@/services/vaultHealthService';
import { saveExportFile } from '@/services/exportFileService';
import { get2FAStatus } from '@/services/twoFactorService';
import { cn } from '@/lib/utils';

import { shouldShowWebsiteChrome } from '@/platform/appShell';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

// Score ring component
function ScoreRing({ score, size = 150 }: { score: number; size?: number }) {
    const radius = (size - 24) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = (score / 100) * circumference;
    const strokeColor =
        score >= 80 ? 'text-success' :
            score >= 60 ? 'text-warning' :
                'text-destructive';

    return (
        <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
            <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className="text-ice-300/10"
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray={`${circumference}`}
                    strokeDashoffset={`${circumference - progress}`}
                    strokeLinecap="round"
                    className={cn('transition-all duration-1000 ease-out', strokeColor)}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={cn('text-3xl font-bold tracking-tight', strokeColor)}>{score}</span>
                <div className="h-px w-6 bg-ice-300/10 my-1" />
                <span className="text-[10px] text-ice-200/40 font-medium">/ 100</span>
            </div>
        </div>
    );
}

// Issue type configuration
const issueConfig = {
    weak: {
        icon: ShieldAlert,
        color: 'text-red-500',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/20',
    },
    pwned: {
        icon: AlertTriangle,
        color: 'text-orange-500',
        bgColor: 'bg-orange-500/10',
        borderColor: 'border-orange-500/20',
    },
    duplicate: {
        icon: Copy,
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-500/10',
        borderColor: 'border-yellow-500/20',
    },
    old: {
        icon: Clock,
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/20',
    },
    reused: {
        icon: RefreshCw,
        color: 'text-purple-500',
        bgColor: 'bg-purple-500/10',
        borderColor: 'border-purple-500/20',
    },
};

const issueLabelKeys: Record<HealthIssueType, string> = {
    weak: 'vaultHealth.weak',
    pwned: 'vaultHealth.pwned',
    duplicate: 'vaultHealth.duplicate',
    old: 'vaultHealth.old',
    reused: 'vaultHealth.reused',
};

const issueLabelDefaultValues: Record<HealthIssueType, string> = {
    weak: 'Schwach',
    pwned: 'Geleakt',
    duplicate: 'Doppelt',
    old: 'Alt',
    reused: 'Wiederverwendet',
};

const issueSeverityDefaultValues: Record<HealthIssue['severity'], string> = {
    critical: 'Kritisch',
    warning: 'Warnung',
    info: 'Info',
};

function IssueCard({
    issue,
    to,
    onNavigateStart,
}: {
    issue: HealthIssue;
    to: string;
    onNavigateStart: () => void;
}) {
    const { t } = useTranslation();
    const config = issueConfig[issue.type] || issueConfig.weak;
    const Icon = config.icon;

    const getDescription = () => {
        const primaryDescription = issue.descriptions[issue.type] ?? issue.description;
        switch (issue.type) {
            case 'weak':
                return t(`vaultHealth.reasons.${primaryDescription}`, {
                    defaultValue: t('vaultHealth.weakPassword', { defaultValue: 'Schwaches Passwort' }),
                });
            case 'pwned':
                return t('vaultHealth.pwnedPassword', {
                    count: Number(primaryDescription) || 1,
                    defaultValue: 'Dieses Passwort wurde in Datenlecks gefunden.',
                });
            case 'duplicate':
                return t('vaultHealth.duplicateWith', {
                    items: primaryDescription,
                    defaultValue: `Duplikat von ${primaryDescription}`,
                });
            case 'old': {
                const days = Math.floor((Date.now() - new Date(primaryDescription).getTime()) / (1000 * 60 * 60 * 24));
                return t('vaultHealth.oldPassword', {
                    days,
                    defaultValue: `Zuletzt vor ${days} Tagen geändert`,
                });
            }
            default:
                return primaryDescription;
        }
    };

    const issueTypeLabel = issue.types
        .map((type) => t(issueLabelKeys[type], { defaultValue: issueLabelDefaultValues[type] }))
        .join(' · ');

    return (
        <Link
            to={to}
            onClick={onNavigateStart}
            className={cn(
                'flex w-full flex-wrap items-start gap-3 rounded-xl border border-ice-300/10 bg-ice-300/[.02] p-3 transition-all sm:flex-nowrap sm:items-center',
                'hover:bg-ice-300/[.06] hover:scale-[1.01] active:scale-[0.99]',
            )}
        >
            <div className={cn('p-2 rounded-lg', config.bgColor)}>
                <Icon className={cn('w-4 h-4', config.color)} />
            </div>
            <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-semibold text-ice-100">{issue.title}</p>
                <p className="break-words text-xs text-ice-200/50">{getDescription()}</p>
                {issue.types.length > 1 && (
                    <p className="mt-1 text-[10px] text-ice-200/30">{issueTypeLabel}</p>
                )}
            </div>
            <Badge
                variant="outline"
                className={cn(
                    'shrink-0 text-[10px] h-5 rounded-full px-2',
                    issue.severity === 'critical' && 'border-red-500/20 bg-red-500/5 text-red-400',
                    issue.severity === 'warning' && 'border-orange-500/20 bg-orange-500/5 text-orange-400',
                    issue.severity === 'info' && 'border-blue-500/20 bg-blue-500/5 text-blue-400',
                )}
            >
                {t(`vaultHealth.severity.${issue.severity}`, {
                    defaultValue: issueSeverityDefaultValues[issue.severity],
                })}
            </Badge>
            <ChevronRight className="w-4 h-4 text-ice-200/30" />
        </Link>
    );
}

export default function VaultHealthPage() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { getVaultHealthAnalysisItems, isLocked, vaultDataVersion } = useVault();
    const showWebsiteChrome = shouldShowWebsiteChrome();

    const [report, setReport] = useState<HealthReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [lastAnalyzed, setLastAnalyzed] = useState<Date | null>(null);
    const [filter, setFilter] = useState<'all' | 'weak' | 'pwned' | 'duplicate' | 'old'>('all');
    const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

    const getVaultHealthAnalysisItemsRef = useRef(getVaultHealthAnalysisItems);
    const analysisRequestIdRef = useRef(0);
    const navigatingToVaultItemRef = useRef(false);

    useEffect(() => {
        getVaultHealthAnalysisItemsRef.current = getVaultHealthAnalysisItems;
    }, [getVaultHealthAnalysisItems]);

    useEffect(() => {
        if (!user && !loading) navigate('/auth', { replace: true });
    }, [user, loading, navigate]);

    useEffect(() => {
        if (isLocked) navigate('/vault', { replace: true });
    }, [isLocked, navigate]);

    // Fetch real 2FA status
    useEffect(() => {
        if (user?.id) {
            get2FAStatus(user.id)
                .then((status) => {
                    setTwoFactorEnabled(!!status?.isEnabled);
                })
                .catch((err) => {
                    console.error('Failed to get 2FA status:', err);
                });
        }
    }, [user?.id]);

    const runAnalysis = useCallback(async () => {
        if (!user) return;
        if (navigatingToVaultItemRef.current) return;
        const requestId = analysisRequestIdRef.current + 1;
        analysisRequestIdRef.current = requestId;
        setLoading(true);
        try {
            const healthReport = await analyzeVaultHealth(await getVaultHealthAnalysisItemsRef.current());
            if (analysisRequestIdRef.current !== requestId || navigatingToVaultItemRef.current) {
                return;
            }
            setReport(healthReport);
            setLastAnalyzed(new Date());
        } catch {
            if (!navigatingToVaultItemRef.current) {
                console.error('Health analysis failed.');
            }
        } finally {
            if (analysisRequestIdRef.current === requestId && !navigatingToVaultItemRef.current) {
                setLoading(false);
            }
        }
    }, [user?.id]);

    useEffect(() => {
        void runAnalysis();
    }, [runAnalysis, vaultDataVersion]);

    const filteredIssues = report?.issues.filter(issue =>
        filter === 'all' || issue.types.includes(filter)
    ) || [];

    const getScoreLabel = (score: number) => {
        if (score >= 80) return t('vaultHealth.scoreExcellent');
        if (score >= 60) return t('vaultHealth.scoreGood');
        if (score >= 40) return t('vaultHealth.scoreFair');
        return t('vaultHealth.scorePoor');
    };

    // Echter Berichtexport über saveExportFile
    const exportJSON = async () => {
        if (!report) return;
        const name = `singra_vault_health_report_${new Date().toISOString().split('T')[0]}.json`;
        await saveExportFile({
            name,
            mime: 'application/json',
            content: JSON.stringify(report, null, 2),
        });
    };

    const exportCSV = async () => {
        if (!report) return;
        const headers = ["Title", "Issue Type", "Severity", "Description"];
        const rows = report.issues.map(issue => [
            issue.title,
            issue.types.join(", "),
            issue.severity,
            issue.description
        ]);
        const csvContent = [headers.join(","), ...rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(","))].join("\n");
        const name = `singra_vault_health_report_${new Date().toISOString().split('T')[0]}.csv`;
        await saveExportFile({
            name,
            mime: 'text/csv',
            content: csvContent,
        });
    };

    const getUniquePercentage = () => {
        if (!report || report.passwordItems === 0) return 100;
        const uniqueCount = report.passwordItems - report.stats.duplicate;
        return Math.max(0, Math.min(100, Math.round((uniqueCount / report.passwordItems) * 100)));
    };

    const mockChartData = report ? [
        { name: '19. Apr', score: 50 },
        { name: '26. Apr', score: 68 },
        { name: '3. Mai', score: 78 },
        { name: '10. Mai', score: 85 },
        { name: 'Heute', score: report.score }
    ] : [];

    return (
        <div className="sv-app-shell min-h-screen flex flex-col bg-background">
            {/* Header */}
            <header className="ms-glass-header sticky top-0 z-50">
                <div className="container mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => navigate('/vault')}>
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="flex flex-col">
                            <h1 className="text-xl font-bold tracking-tight text-white">{t('vaultHealth.title')}</h1>
                            <p className="text-xs text-ice-200/50">
                                {t('vaultHealth.subtitle')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {report && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="flex items-center gap-1.5 h-9 rounded-xl border-ice-300/15 text-ice-100 hover:bg-ice-300/[.06]">
                                        <Download className="size-4" />
                                        <span>{t('vaultHealth.exportReport')}</span>
                                        <ChevronDown className="size-3 opacity-60" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={exportJSON}>JSON exportieren</DropdownMenuItem>
                                    <DropdownMenuItem onClick={exportCSV}>CSV exportieren</DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        <LanguageSwitcher
                            language={i18n?.language === 'de' ? 'de' : 'en'}
                            onChange={(lang) => i18n.changeLanguage(lang)}
                        />
                    </div>
                </div>
            </header>

            <main className="container mx-auto max-w-5xl flex-1 px-4 py-6 sm:py-8 space-y-6 relative z-10">
                <FeatureGate feature="vault_health_reports">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            <p className="text-muted-foreground">{t('vaultHealth.analyzing')}</p>
                        </div>
                    ) : report ? (
                        <div className="space-y-6">
                            {/* Row 1: Score & History */}
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                                {/* Score Card */}
                                <Card className="md:col-span-7 glass">
                                    <CardContent className="p-6 flex flex-col sm:flex-row items-center gap-6 h-full justify-center">
                                        <div className="flex flex-col items-center gap-2 shrink-0">
                                            <ScoreRing score={report.score} />
                                            <div className={cn(
                                                "flex items-center gap-1.5 font-semibold text-xs px-2.5 py-1 rounded-full border",
                                                report.score >= 80 ? "text-success border-success/20 bg-success/5" :
                                                report.score >= 60 ? "text-warning border-warning/20 bg-warning/5" :
                                                "text-destructive border-destructive/20 bg-destructive/5"
                                            )}>
                                                <ShieldCheck className="size-3.5" />
                                                <span>{getScoreLabel(report.score)}</span>
                                            </div>
                                        </div>
                                        <div className="flex-1 text-center sm:text-left space-y-3">
                                            <h2 className="text-xl font-bold text-white leading-snug">
                                                {getScoreLabel(report.score)}
                                            </h2>
                                            <p className="text-sm text-ice-200/60 leading-relaxed">
                                                {t('vaultHealth.analyzed', {
                                                    count: report.passwordItems,
                                                    total: report.totalItems,
                                                })}
                                            </p>
                                            <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={runAnalysis}
                                                    className="h-9 px-4 rounded-xl font-semibold flex items-center justify-center gap-1.5"
                                                >
                                                    <RefreshCw className="w-3.5 h-3.5" />
                                                    {t('vaultHealth.reanalyze')}
                                                </Button>
                                                {lastAnalyzed && (
                                                    <span className="text-xs text-ice-200/40 font-medium">
                                                        {t('vaultHealth.lastAnalysisJustNow')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* History Card */}
                                <Card className="md:col-span-5 glass">
                                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                                        <CardTitle className="text-sm font-semibold text-ice-100">
                                            {t('vaultHealth.historyTitle')}
                                        </CardTitle>
                                        <Badge variant="outline" className="border-ice-300/10 text-[10px] text-ice-200/50">
                                            {t('vaultHealth.last30days')}
                                        </Badge>
                                    </CardHeader>
                                    <CardContent className="p-4 pt-0">
                                        <div className="h-[140px] w-full mt-2">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={mockChartData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.04)" vertical={false} />
                                                    <XAxis
                                                        dataKey="name"
                                                        stroke="rgba(255, 255, 255, 0.2)"
                                                        fontSize={9}
                                                        tickLine={false}
                                                        axisLine={false}
                                                    />
                                                    <YAxis
                                                        domain={[0, 100]}
                                                        stroke="rgba(255, 255, 255, 0.2)"
                                                        fontSize={9}
                                                        tickLine={false}
                                                        axisLine={false}
                                                        tickCount={5}
                                                    />
                                                    <Tooltip
                                                        contentStyle={{
                                                            backgroundColor: 'rgba(7, 10, 20, 0.95)',
                                                            borderColor: 'rgba(255, 255, 255, 0.08)',
                                                            borderRadius: '12px',
                                                            color: '#fff',
                                                            fontSize: '10px',
                                                            boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
                                                        }}
                                                    />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="score"
                                                        stroke="hsl(158, 64%, 52%)"
                                                        strokeWidth={2.5}
                                                        dot={{ fill: 'hsl(158, 64%, 52%)', r: 3.5, strokeWidth: 0 }}
                                                        activeDot={{ r: 5 }}
                                                    />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Row 2: 5 Stats Cards */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                                <Card className={cn(
                                    'cursor-pointer transition-all hover:bg-ice-300/[.04] hover:scale-[1.02] active:scale-[0.98] glass border-ice-300/10',
                                    filter === 'weak' && 'border-red-500/30 bg-red-500/[0.02]'
                                )} onClick={() => setFilter(filter === 'weak' ? 'all' : 'weak')}>
                                    <CardContent className="p-4 text-center flex flex-col items-center justify-center">
                                        <div className="p-2 rounded-xl bg-red-500/10 mb-2">
                                            <ShieldAlert className="w-5 h-5 text-red-400" />
                                        </div>
                                        <p className="text-2xl font-bold text-white leading-none">{report.stats.weak}</p>
                                        <p className="text-xs text-ice-200/50 mt-2 font-medium">{t('vaultHealth.weak')}</p>
                                    </CardContent>
                                </Card>

                                <Card className={cn(
                                    'cursor-pointer transition-all hover:bg-ice-300/[.04] hover:scale-[1.02] active:scale-[0.98] glass border-ice-300/10',
                                    filter === 'pwned' && 'border-orange-500/30 bg-orange-500/[0.02]'
                                )} onClick={() => setFilter(filter === 'pwned' ? 'all' : 'pwned')}>
                                    <CardContent className="p-4 text-center flex flex-col items-center justify-center">
                                        <div className="p-2 rounded-xl bg-orange-500/10 mb-2">
                                            <AlertTriangle className="w-5 h-5 text-orange-400" />
                                        </div>
                                        <p className="text-2xl font-bold text-white leading-none">{report.stats.pwned}</p>
                                        <p className="text-xs text-ice-200/50 mt-2 font-medium">
                                            {t('vaultHealth.pwned')}
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className={cn(
                                    'cursor-pointer transition-all hover:bg-ice-300/[.04] hover:scale-[1.02] active:scale-[0.98] glass border-ice-300/10',
                                    filter === 'duplicate' && 'border-yellow-500/30 bg-yellow-500/[0.02]'
                                )} onClick={() => setFilter(filter === 'duplicate' ? 'all' : 'duplicate')}>
                                    <CardContent className="p-4 text-center flex flex-col items-center justify-center">
                                        <div className="p-2 rounded-xl bg-yellow-500/10 mb-2">
                                            <Copy className="w-5 h-5 text-yellow-400" />
                                        </div>
                                        <p className="text-2xl font-bold text-white leading-none">{report.stats.duplicate}</p>
                                        <p className="text-xs text-ice-200/50 mt-2 font-medium">{t('vaultHealth.duplicate')}</p>
                                    </CardContent>
                                </Card>

                                <Card className={cn(
                                    'cursor-pointer transition-all hover:bg-ice-300/[.04] hover:scale-[1.02] active:scale-[0.98] glass border-ice-300/10',
                                    filter === 'old' && 'border-blue-500/30 bg-blue-500/[0.02]'
                                )} onClick={() => setFilter(filter === 'old' ? 'all' : 'old')}>
                                    <CardContent className="p-4 text-center flex flex-col items-center justify-center">
                                        <div className="p-2 rounded-xl bg-blue-500/10 mb-2">
                                            <Clock className="w-5 h-5 text-blue-400" />
                                        </div>
                                        <p className="text-2xl font-bold text-white leading-none">{report.stats.old}</p>
                                        <p className="text-xs text-ice-200/50 mt-2 font-medium">{t('vaultHealth.old')}</p>
                                    </CardContent>
                                </Card>

                                <Card className="glass border-ice-300/10">
                                    <CardContent className="p-4 text-center flex flex-col items-center justify-center">
                                        <div className="p-2 rounded-xl bg-green-500/10 mb-2">
                                            <ShieldCheck className="w-5 h-5 text-green-400" />
                                        </div>
                                        <p className="text-2xl font-bold text-white leading-none">{report.stats.strong}</p>
                                        <p className="text-xs text-ice-200/50 mt-2 font-medium">{t('vaultHealth.strong')}</p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Row 3: Issues List (7 cols) & Security Tips (5 cols) */}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                                {/* Issues List */}
                                <div className="lg:col-span-7 space-y-3">
                                    <h3 className="text-sm font-bold text-white px-1">
                                        {t('vaultHealth.issues')}
                                    </h3>
                                    <Card className="glass overflow-hidden">
                                        <div className="flex items-center gap-1.5 border-b border-ice-300/10 p-3 bg-ice-300/[.015]">
                                            {(['all', 'weak', 'pwned', 'duplicate', 'old'] as const).map((type) => (
                                                <button
                                                    key={type}
                                                    onClick={() => setFilter(type)}
                                                    className={cn(
                                                        "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                                                        filter === type
                                                            ? "bg-ice-300/15 text-white shadow-sm"
                                                            : "text-ice-200/50 hover:text-white hover:bg-ice-300/[.03]"
                                                    )}
                                                >
                                                    {type === 'all' ? t('common.all') :
                                                     type === 'weak' ? t('vaultHealth.weak') :
                                                     type === 'pwned' ? t('vaultHealth.pwned') :
                                                     type === 'duplicate' ? t('vaultHealth.duplicate') :
                                                     t('vaultHealth.old')}
                                                </button>
                                            ))}
                                        </div>
                                        <CardContent className="p-4 space-y-2.5 max-h-[380px] overflow-y-auto">
                                            {filteredIssues.length > 0 ? (
                                                filteredIssues.map((issue, i) => (
                                                    <IssueCard
                                                        key={`${issue.itemId}-${issue.type}-${i}`}
                                                        issue={issue}
                                                        to={`/vault?item=${encodeURIComponent(issue.itemId)}&source=vault-health`}
                                                        onNavigateStart={() => {
                                                            navigatingToVaultItemRef.current = true;
                                                        }}
                                                    />
                                                ))
                                            ) : (
                                                <div className="p-12 text-center flex flex-col items-center justify-center min-h-[260px]">
                                                    <Shield className="w-12 h-12 text-success/20 mb-4 animate-[pulse_3s_infinite]" />
                                                    <h4 className="text-sm font-bold text-white">
                                                        {t('vaultHealth.noIssuesFound')}
                                                    </h4>
                                                    <p className="text-xs text-ice-200/40 mt-1 max-w-[280px] mx-auto leading-relaxed">
                                                        {t('vaultHealth.noIssuesDesc')}
                                                    </p>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                </div>

                                {/* Security Tips (Context Driven) */}
                                <div className="lg:col-span-5 space-y-3">
                                    <h3 className="text-sm font-bold text-white px-1">
                                        {t('vaultHealth.securityTips')}
                                    </h3>
                                    <Card className="glass overflow-hidden flex flex-col justify-between h-[426px]">
                                        <CardContent className="p-4 space-y-3">
                                            {/* Tip 1: Unique Passwords */}
                                            <div
                                                onClick={() => setFilter(report.stats.duplicate > 0 ? 'duplicate' : 'all')}
                                                className={cn(
                                                    "flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]",
                                                    report.stats.duplicate > 0
                                                        ? "border-yellow-500/20 bg-yellow-500/[.02] hover:bg-yellow-500/[.04]"
                                                        : "border-ice-300/10 bg-ice-300/[.01] hover:bg-ice-300/[.03]"
                                                )}
                                            >
                                                <div className={cn("p-2 rounded-lg shrink-0", report.stats.duplicate > 0 ? "bg-yellow-500/10" : "bg-green-500/10")}>
                                                    {report.stats.duplicate > 0 ? <Copy className="size-4 text-yellow-400" /> : <ShieldCheck className="size-4 text-green-400" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <h4 className="text-xs font-bold text-white leading-snug">
                                                            {t('vaultHealth.tip1Title', { defaultValue: 'Einzigartigkeit prüfen' })}
                                                        </h4>
                                                        {report.stats.duplicate > 0 && (
                                                            <Badge variant="outline" className="h-4 text-[8px] px-1 bg-yellow-500/10 border-yellow-500/25 text-yellow-400 uppercase font-bold shrink-0">
                                                                Aktion nötig
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] text-ice-200/40 mt-0.5 leading-normal">
                                                        {report.stats.duplicate > 0
                                                            ? t('vaultHealth.tips.duplicateFound', { count: report.stats.duplicate })
                                                            : t('vaultHealth.tips.noDuplicate')
                                                        }
                                                    </p>
                                                </div>
                                                <ChevronRight className="size-3.5 text-ice-200/20 self-center shrink-0" />
                                            </div>

                                            {/* Tip 2: Two-Factor Authentication */}
                                            <div
                                                onClick={() => navigate('/vault/settings')}
                                                className={cn(
                                                    "flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]",
                                                    !twoFactorEnabled
                                                        ? "border-red-500/20 bg-red-500/[.02] hover:bg-red-500/[.04]"
                                                        : "border-ice-300/10 bg-ice-300/[.01] hover:bg-ice-300/[.03]"
                                                )}
                                            >
                                                <div className={cn("p-2 rounded-lg shrink-0", !twoFactorEnabled ? "bg-red-500/10" : "bg-green-500/10")}>
                                                    {!twoFactorEnabled ? <Lock className="size-4 text-red-400" /> : <ShieldCheck className="size-4 text-green-400" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <h4 className="text-xs font-bold text-white leading-snug">
                                                            {t('vaultHealth.tip2Title')}
                                                        </h4>
                                                        <Badge variant="outline" className={cn(
                                                            "h-4 text-[8px] px-1 uppercase font-bold shrink-0",
                                                            !twoFactorEnabled
                                                                ? "bg-red-500/10 border-red-500/25 text-red-400"
                                                                : "bg-green-500/10 border-green-500/25 text-green-400"
                                                        )}>
                                                            {!twoFactorEnabled ? "Inaktiv" : "Aktiv"}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-[10px] text-ice-200/40 mt-0.5 leading-normal">
                                                        {!twoFactorEnabled
                                                            ? t('vaultHealth.tips.twoFactorDisabled')
                                                            : t('vaultHealth.tips.twoFactorEnabled')
                                                        }
                                                    </p>
                                                </div>
                                                <ChevronRight className="size-3.5 text-ice-200/20 self-center shrink-0" />
                                            </div>

                                            {/* Tip 3: Weak Passwords */}
                                            <div
                                                onClick={() => setFilter(report.stats.weak > 0 ? 'weak' : 'all')}
                                                className={cn(
                                                    "flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]",
                                                    report.stats.weak > 0
                                                        ? "border-red-500/20 bg-red-500/[.02] hover:bg-red-500/[.04]"
                                                        : "border-ice-300/10 bg-ice-300/[.01] hover:bg-ice-300/[.03]"
                                                )}
                                            >
                                                <div className={cn("p-2 rounded-lg shrink-0", report.stats.weak > 0 ? "bg-red-500/10" : "bg-green-500/10")}>
                                                    {report.stats.weak > 0 ? <ShieldAlert className="size-4 text-red-400" /> : <ShieldCheck className="size-4 text-green-400" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <h4 className="text-xs font-bold text-white leading-snug">
                                                            {t('vaultHealth.tip3Title')}
                                                        </h4>
                                                        {report.stats.weak > 0 && (
                                                            <Badge variant="outline" className="h-4 text-[8px] px-1 bg-red-500/10 border-red-500/25 text-red-400 uppercase font-bold shrink-0">
                                                                Aktion nötig
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] text-ice-200/40 mt-0.5 leading-normal">
                                                        {report.stats.weak > 0
                                                            ? t('vaultHealth.tips.weakFound', { count: report.stats.weak })
                                                            : t('vaultHealth.tips.noWeak')
                                                        }
                                                    </p>
                                                </div>
                                                <ChevronRight className="size-3.5 text-ice-200/20 self-center shrink-0" />
                                            </div>

                                            {/* Tip 4: Old Passwords */}
                                            <div
                                                onClick={() => setFilter(report.stats.old > 0 ? 'old' : 'all')}
                                                className={cn(
                                                    "flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]",
                                                    report.stats.old > 0
                                                        ? "border-blue-500/20 bg-blue-500/[.02] hover:bg-blue-500/[.04]"
                                                        : "border-ice-300/10 bg-ice-300/[.01] hover:bg-ice-300/[.03]"
                                                )}
                                            >
                                                <div className={cn("p-2 rounded-lg shrink-0", report.stats.old > 0 ? "bg-blue-500/10" : "bg-green-500/10")}>
                                                    {report.stats.old > 0 ? <Clock className="size-4 text-blue-400" /> : <ShieldCheck className="size-4 text-green-400" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <h4 className="text-xs font-bold text-white leading-snug">
                                                            {t('vaultHealth.tip4Title')}
                                                        </h4>
                                                        {report.stats.old > 0 && (
                                                            <Badge variant="outline" className="h-4 text-[8px] px-1 bg-blue-500/10 border-blue-500/25 text-blue-400 uppercase font-bold shrink-0">
                                                                Empfohlen
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] text-ice-200/40 mt-0.5 leading-normal">
                                                        {report.stats.old > 0
                                                            ? t('vaultHealth.tips.oldFound', { count: report.stats.old })
                                                            : t('vaultHealth.tips.noOld')
                                                        }
                                                    </p>
                                                </div>
                                                <ChevronRight className="size-3.5 text-ice-200/20 self-center shrink-0" />
                                            </div>
                                        </CardContent>
                                        <CardFooter className="p-4 pt-0">
                                            <Button variant="outline" className="w-full text-xs h-9 rounded-xl border-ice-300/10 text-ice-200/70 hover:bg-ice-300/[.06] flex items-center justify-center gap-1.5 shadow-none">
                                                <span>{t('vaultHealth.moreTips')}</span>
                                                <ChevronRight className="size-3.5" />
                                            </Button>
                                        </CardFooter>
                                    </Card>
                                </div>
                            </div>

                            {/* Row 4: Horizontal Footer Stats Bar (Only 3 columns, AES-256 removed) */}
                            <Card className="glass p-4 rounded-xl border-ice-300/10">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:divide-x sm:divide-ice-300/10">
                                    {/* Stat 1: Gesamt Einträge */}
                                    <div className="flex items-center gap-3.5 justify-center sm:justify-start sm:px-4">
                                        <div className="p-2 rounded-xl bg-primary/10 shrink-0">
                                            <Database className="w-5 h-5 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-2xl font-bold text-white leading-none">{report.totalItems}</p>
                                            <p className="text-[9px] uppercase font-bold tracking-wider text-ice-200/45 mt-1">
                                                {t('vaultHealth.totalEntries')}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Stat 2: Einzigartige Passwörter */}
                                    <div className="flex items-center gap-3.5 justify-center sm:justify-start sm:px-6">
                                        <div className="p-2 rounded-xl bg-success/10 shrink-0">
                                            <Fingerprint className="w-5 h-5 text-success" />
                                        </div>
                                        <div>
                                            <p className="text-2xl font-bold text-white leading-none">{getUniquePercentage()}%</p>
                                            <p className="text-[9px] uppercase font-bold tracking-wider text-ice-200/45 mt-1">
                                                {t('vaultHealth.uniquePasswords')}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Stat 3: Betroffene Konten */}
                                    <div className="flex items-center gap-3.5 justify-center sm:justify-start sm:px-6">
                                        <div className="p-2 rounded-xl bg-orange-500/10 shrink-0">
                                            <User className="w-5 h-5 text-orange-400" />
                                        </div>
                                        <div>
                                            <p className="text-2xl font-bold text-white leading-none">{report.stats.pwned}</p>
                                            <p className="text-[9px] uppercase font-bold tracking-wider text-ice-200/45 mt-1">
                                                {t('vaultHealth.affectedAccounts')}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </div>
                    ) : null}
                </FeatureGate>
            </main>
            {showWebsiteChrome && (
                <footer className="border-t border-border/40 px-4 lg:px-6 py-3 text-xs text-muted-foreground relative z-10">
                    <nav className="flex flex-wrap items-center gap-3">
                        <Link to="/privacy" className="hover:text-foreground transition-colors">
                            {t('landing.footer.privacy')}
                        </Link>
                        <Link to="/impressum" className="hover:text-foreground transition-colors">
                            {t('landing.footer.imprint')}
                        </Link>
                        <button
                            type="button"
                            onClick={() => window.dispatchEvent(new Event('singra:open-cookie-settings'))}
                            className="hover:text-foreground transition-colors"
                        >
                            {t('landing.footer.cookies')}
                        </button>
                    </nav>
                </footer>
            )}
        </div>
    );
}
