// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Cookie, Shield, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CookieConsentProps {
    variant?: "default" | "minimal";
}

export const CookieConsent = ({ variant = "default" }: CookieConsentProps) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [showBanner, setShowBanner] = useState(false);

    // Consent state
    const [necessary, setNecessary] = useState(true); // Always true
    const [optional, setOptional] = useState(false);

    // Check for existing consent on mount


    // Listen for custom event to open settings
    useEffect(() => {
        const handleOpenSettings = () => setIsOpen(true);
        window.addEventListener('singra:open-cookie-settings', handleOpenSettings);
        return () => window.removeEventListener('singra:open-cookie-settings', handleOpenSettings);
    }, []);

    // Check for existing consent on mount
    useEffect(() => {
        const consent = localStorage.getItem("singra-cookie-consent");
        if (!consent) {
            // Small delay for animation smooth entry
            const timer = setTimeout(() => setShowBanner(true), 1000);
            return () => clearTimeout(timer);
        } else {
            // If consent exists, load it to state (in case we want to allow editing later via footer)
            try {
                const parsed = JSON.parse(consent);
                setOptional(parsed.optional);
            } catch (e) {
                console.error("Failed to parse cookie consent", e);
            }
        }
    }, []);

    const handleAcceptAll = () => {
        const consent = {
            necessary: true,
            optional: true,
            timestamp: new Date().toISOString(),
        };
        localStorage.setItem("singra-cookie-consent", JSON.stringify(consent));
        setOptional(true);
        setShowBanner(false);
    };

    const handleSaveSettings = () => {
        const consent = {
            necessary: true,
            optional: optional,
            timestamp: new Date().toISOString(),
        };
        localStorage.setItem("singra-cookie-consent", JSON.stringify(consent));
        setShowBanner(false);
        setIsOpen(false);
    };

    if (!showBanner && !isOpen) return null;

    return (
        <>
            {/* Banner */}
            {showBanner && (
                <div className={cn(
                    "fixed bottom-0 left-0 right-0 z-50 p-4 m-4 md:m-6",
                    "bg-background/80 backdrop-blur-lg border border-border/50 rounded-xl shadow-2xl",
                    "flex flex-col md:flex-row items-start md:items-center justify-between gap-4",
                    "animate-in slide-in-from-bottom-10 fade-in duration-500"
                )}>
                    <div className="flex items-start gap-4">
                        <div className="p-2 bg-primary/10 rounded-full hidden sm:block">
                            <Cookie className="h-6 w-6 text-primary" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-semibold text-lg flex items-center gap-2">
                                <Cookie className="h-5 w-5 text-primary sm:hidden" />
                                {t("cookies.banner.title")}
                            </h3>
                            <p className="text-sm text-muted-foreground max-w-2xl">
                                {t("cookies.banner.description")}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
                        <Button variant="outline" onClick={() => setIsOpen(true)}>
                            {t("cookies.banner.manage")}
                        </Button>
                        <Button onClick={handleAcceptAll}>
                            {t("cookies.banner.acceptAll")}
                        </Button>
                    </div>
                </div>
            )}

            {/* Settings Dialog */}
            <Dialog open={isOpen} onOpenChange={(open) => {
                if (!open && showBanner) {
                    // If closing dialog without saving and banner is still supposed to be shown, do nothing special, just close dialog logic
                }
                setIsOpen(open);
            }}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{t("cookies.settings.title")}</DialogTitle>
                        <DialogDescription>
                            {t("cookies.settings.description")}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-6 py-4">
                        {/* Necessary */}
                        <div className="flex items-start justify-between space-x-4">
                            <div className="space-y-1">
                                <Label htmlFor="necessary" className="text-base font-medium flex items-center gap-2">
                                    {t("cookies.categories.necessary.title")}
                                    <Shield className="h-3 w-3 text-primary" />
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    {t("cookies.categories.necessary.description")}
                                </p>
                            </div>
                            <Switch id="necessary" checked={true} disabled />
                        </div>

                        {/* Optional */}
                        <div className="flex items-start justify-between space-x-4">
                            <div className="space-y-1">
                                <Label htmlFor="optional" className="text-base font-medium">
                                    {t("cookies.categories.optional.title")}
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    {t("cookies.categories.optional.description")}
                                </p>
                            </div>
                            <Switch
                                id="optional"
                                checked={optional}
                                onCheckedChange={setOptional}
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setIsOpen(false)}>
                            {t("common.cancel")}
                        </Button>
                        <Button onClick={handleSaveSettings} className="gap-2">
                            <Check className="h-4 w-4" />
                            {t("cookies.settings.save")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};
