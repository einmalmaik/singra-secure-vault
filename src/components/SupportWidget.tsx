// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Floating Support Widget
 *
 * Global floating widget accessible on all pages. Provides quick access to support
 * ticket creation without navigating to settings.
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    LifeBuoy,
    X,
    Send,
    Loader2,
    Clock3,
    MessageSquare,
    ShieldAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
    getSupportResponseMetrics,
    listSupportTickets,
    submitSupportTicket,
    type CreateSupportTicketInput,
    type SupportEntitlement,
    type SupportTicketSummary,
} from '@/services/supportService';

const CATEGORY_OPTIONS: Array<CreateSupportTicketInput['category']> = [
    'general',
    'technical',
    'billing',
    'security',
    'family',
    'other',
];

/**
 * Floating support widget button + panel.
 *
 * @returns Floating support widget
 */
export function SupportWidget() {
    const { user } = useAuth();
    const { t, i18n } = useTranslation();
    const { toast } = useToast();

    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'create' | 'tickets'>('create');

    const [subject, setSubject] = useState('');
    const [category, setCategory] = useState<CreateSupportTicketInput['category']>('general');
    const [message, setMessage] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const [entitlement, setEntitlement] = useState<SupportEntitlement | null>(null);
    const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);

    const currentSlaText = useMemo(() => {
        const slaHours = entitlement?.sla_hours ?? 72;
        if (slaHours <= 24) {
            return t('settings.support.sla.priority24h');
        }
        return t('settings.support.sla.standard72h');
    }, [entitlement?.sla_hours, t]);

    const isPriority = entitlement?.is_priority ?? false;

    const loadSupportData = async () => {
        setIsLoading(true);

        const { entitlement: ent, tickets: tix } = await listSupportTickets();

        setEntitlement(ent);
        setTickets(tix);
        setIsLoading(false);
    };

    useEffect(() => {
        if (isOpen && user) {
            void loadSupportData();
        }
    }, [isOpen, user]);

    const handleSubmit = async () => {
        if (subject.trim().length < 3 || message.trim().length < 10) {
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('settings.support.validation'),
            });
            return;
        }

        setIsSubmitting(true);
        const { error } = await submitSupportTicket({
            subject: subject.trim(),
            category,
            message: message.trim(),
        });
        setIsSubmitting(false);

        if (error) {
            toast({
                variant: 'destructive',
                title: t('common.error'),
                description: t('settings.support.submitError'),
            });
            return;
        }

        setSubject('');
        setMessage('');
        setCategory('general');

        toast({
            title: t('common.success'),
            description: t('settings.support.submitSuccess'),
        });

        await loadSupportData();
        setActiveTab('tickets');
    };

    const formatDate = (isoDate: string) => {
        return new Date(isoDate).toLocaleString(i18n.language === 'de' ? 'de-DE' : 'en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getStatusLabel = (status: SupportTicketSummary['status']) => {
        return t(`settings.support.status.${status}`);
    };

    const getStatusVariant = (status: SupportTicketSummary['status']) => {
        if (status === 'resolved' || status === 'closed') {
            return 'secondary' as const;
        }
        if (status === 'in_progress') {
            return 'default' as const;
        }
        return 'outline' as const;
    };

    // Only render if user is logged in
    if (!user) {
        return null;
    }

    return (
        <>
            {/* Floating Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg hover:bg-primary/90 transition-all"
                    aria-label={t('settings.support.title')}
                >
                    <LifeBuoy className="w-5 h-5" />
                    <span className="hidden sm:inline font-medium">Support</span>
                </button>
            )}

            {/* Floating Panel */}
            {isOpen && (
                <div className="fixed bottom-6 right-6 z-50 w-[90vw] max-w-md h-[600px] flex flex-col shadow-2xl rounded-lg border bg-background">
                    <Card className="flex flex-col h-full border-0 shadow-none">
                        <CardHeader className="flex-shrink-0 border-b">
                            <div className="flex items-center justify-between">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <LifeBuoy className="w-5 h-5" />
                                    {t('settings.support.title')}
                                </CardTitle>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setIsOpen(false)}
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>

                            {/* SLA Badge */}
                            <div className="flex items-center gap-2 mt-2">
                                <Clock3 className="w-4 h-4 text-muted-foreground" />
                                <Badge variant={isPriority ? 'default' : 'secondary'} className="text-xs">
                                    {currentSlaText}
                                </Badge>
                            </div>

                            {/* Tabs */}
                            <div className="flex gap-2 mt-3">
                                <Button
                                    variant={activeTab === 'create' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setActiveTab('create')}
                                    className="flex-1"
                                >
                                    {t('settings.support.newTicket')}
                                </Button>
                                <Button
                                    variant={activeTab === 'tickets' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setActiveTab('tickets')}
                                    className="flex-1"
                                >
                                    {t('settings.support.myTickets')}
                                </Button>
                            </div>
                        </CardHeader>

                        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
                            {activeTab === 'create' && (
                                <>
                                    {/* Security Warning */}
                                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                                        <div className="flex items-start gap-2">
                                            <ShieldAlert className="w-3.5 h-3.5 mt-0.5 text-amber-600" />
                                            <p>{t('settings.support.securityHint')}</p>
                                        </div>
                                    </div>

                                    {/* Ticket Form */}
                                    <div className="space-y-3">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="widget-subject" className="text-sm">
                                                {t('settings.support.subject')}
                                            </Label>
                                            <Input
                                                id="widget-subject"
                                                value={subject}
                                                onChange={(e) => setSubject(e.target.value)}
                                                maxLength={160}
                                                placeholder={t('settings.support.subjectPlaceholder')}
                                                className="text-sm"
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label className="text-sm">{t('settings.support.category')}</Label>
                                            <Select
                                                value={category}
                                                onValueChange={(value) =>
                                                    setCategory(value as CreateSupportTicketInput['category'])
                                                }
                                            >
                                                <SelectTrigger className="w-full text-sm">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {CATEGORY_OPTIONS.map((option) => (
                                                        <SelectItem key={option} value={option}>
                                                            {t(`settings.support.categories.${option}`)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label htmlFor="widget-message" className="text-sm">
                                                {t('settings.support.message')}
                                            </Label>
                                            <Textarea
                                                id="widget-message"
                                                value={message}
                                                onChange={(e) => setMessage(e.target.value)}
                                                minLength={10}
                                                maxLength={5000}
                                                rows={8}
                                                placeholder={t('settings.support.messagePlaceholder')}
                                                className="text-sm resize-none"
                                            />
                                        </div>

                                        <Button
                                            onClick={handleSubmit}
                                            disabled={isSubmitting}
                                            className="w-full flex items-center gap-2"
                                            size="sm"
                                        >
                                            {isSubmitting ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Send className="w-4 h-4" />
                                            )}
                                            {isSubmitting
                                                ? t('settings.support.submitting')
                                                : t('settings.support.submit')}
                                        </Button>
                                    </div>
                                </>
                            )}

                            {activeTab === 'tickets' && (
                                <div className="space-y-3">
                                    {isLoading && (
                                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            {t('common.loading')}
                                        </div>
                                    )}

                                    {!isLoading && tickets.length === 0 && (
                                        <p className="text-sm text-muted-foreground">
                                            {t('settings.support.noTickets')}
                                        </p>
                                    )}

                                    {!isLoading &&
                                        tickets.map((ticket) => (
                                            <div
                                                key={ticket.id}
                                                className="rounded-lg border p-3 space-y-2 hover:bg-muted/30 transition-colors"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="font-medium text-sm line-clamp-2">
                                                        {ticket.subject}
                                                    </p>
                                                    <Badge variant={getStatusVariant(ticket.status)} className="text-xs">
                                                        {getStatusLabel(ticket.status)}
                                                    </Badge>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                                    <span>{t(`settings.support.categories.${ticket.category}`)}</span>
                                                    <span>•</span>
                                                    <span>{formatDate(ticket.created_at)}</span>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </>
    );
}
