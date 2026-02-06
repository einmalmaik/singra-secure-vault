/**
 * @fileoverview Comparison Table Section
 * 
 * Compares Singra PW with other password managers.
 */

import { useTranslation } from 'react-i18next';
import { Check, X, Minus } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type FeatureStatus = 'yes' | 'no' | 'partial';

interface Competitor {
  name: string;
  features: Record<string, FeatureStatus>;
}

const competitors: Competitor[] = [
  {
    name: 'Singra PW',
    features: {
      openSource: 'yes',
      e2ee: 'yes',
      zeroKnowledge: 'yes',
      free: 'yes',
      selfHostable: 'yes',
      totp: 'yes',
    },
  },
  {
    name: 'LastPass',
    features: {
      openSource: 'no',
      e2ee: 'yes',
      zeroKnowledge: 'yes',
      free: 'partial',
      selfHostable: 'no',
      totp: 'yes',
    },
  },
  {
    name: '1Password',
    features: {
      openSource: 'no',
      e2ee: 'yes',
      zeroKnowledge: 'yes',
      free: 'no',
      selfHostable: 'no',
      totp: 'yes',
    },
  },
  {
    name: 'Bitwarden',
    features: {
      openSource: 'yes',
      e2ee: 'yes',
      zeroKnowledge: 'yes',
      free: 'yes',
      selfHostable: 'yes',
      totp: 'partial',
    },
  },
];

const featureKeys = ['openSource', 'e2ee', 'zeroKnowledge', 'free', 'selfHostable', 'totp'];

function StatusIcon({ status }: { status: FeatureStatus }) {
  switch (status) {
    case 'yes':
      return <Check className="w-5 h-5 text-success mx-auto" />;
    case 'no':
      return <X className="w-5 h-5 text-destructive mx-auto" />;
    case 'partial':
      return <Minus className="w-5 h-5 text-warning mx-auto" />;
  }
}

export function Comparison() {
  const { t } = useTranslation();

  return (
    <section id="comparison" className="py-20">
      <div className="container px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            {t('landing.comparison.title')}
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {t('landing.comparison.subtitle')}
          </p>
        </div>

        <div className="max-w-4xl mx-auto overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Feature</TableHead>
                {competitors.map((c) => (
                  <TableHead key={c.name} className="text-center">
                    <span className={c.name === 'Singra PW' ? 'text-primary font-bold' : ''}>
                      {c.name}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {featureKeys.map((featureKey) => (
                <TableRow key={featureKey}>
                  <TableCell className="font-medium">
                    {t(`landing.comparison.features.${featureKey}`)}
                  </TableCell>
                  {competitors.map((c) => (
                    <TableCell key={`${c.name}-${featureKey}`} className="text-center">
                      <StatusIcon status={c.features[featureKey]} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Legend */}
        <div className="flex justify-center gap-6 mt-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-success" />
            <span>Vollständig</span>
          </div>
          <div className="flex items-center gap-2">
            <Minus className="w-4 h-4 text-warning" />
            <span>Eingeschränkt</span>
          </div>
          <div className="flex items-center gap-2">
            <X className="w-4 h-4 text-destructive" />
            <span>Nicht verfügbar</span>
          </div>
        </div>
      </div>
    </section>
  );
}
