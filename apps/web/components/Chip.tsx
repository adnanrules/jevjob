"use client";
// A job's token. The same layoutId appears in the machine and on its board row, so when a job is
// ranked its chip physically flies from the machine into its row.
import { motion } from "motion/react";
import { hueOf, monogram } from "@/lib/tiers";

export function Chip({ id, company, className = "" }: { id: string; company: string; className?: string }) {
  return (
    <motion.span
      layoutId={`chip-${id}`}
      className={`chip ${className}`}
      style={{ ["--h" as string]: hueOf(company) }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      title={company}
    >
      {monogram(company)}
    </motion.span>
  );
}
