import * as React from "react";
import {
  Card as DnaCard,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody as CardContent,
  CardFooter,
} from "@maunting/design-dna";
import type { CardProps } from "@maunting/design-dna";

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ tone = "elevated", edge = true, ...props }, ref) => (
    <DnaCard ref={ref} tone={tone} edge={edge} {...props} />
  )
);
Card.displayName = "Card";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };

