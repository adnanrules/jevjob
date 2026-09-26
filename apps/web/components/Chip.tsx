"use client";
// A job's token. The same layoutId appears on the rail and on its board row, so when a job is
// ranked its chip flies from the rail into its row.
import { motion } from "motion/react";
import { monogram } from "@/lib/tiers";

export function Chip({ id, company, className = "" }: { id: string; company: string; className?: string }) {
  return (
    <motion.span layoutId={`chip-${id}`} className={`chip ${className}`} transition={{ type: "spring", stiffness: 260, damping: 32 }} title={company}>
      {monogram(company)}
    </motion.span>
  );
}
