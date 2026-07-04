/**
 * @file seed-marketplace-demo.ts
 * @description Dev seed for the Skill & Data Marketplace (TASK-156). Ports the
 *              former frontend mock data (app mockMarketplaceData.ts) verbatim:
 *              10 listings, 6 sellers, reviews (incl. German ones), 4 license
 *              tiers each, seeded purchases + credit ledger, and REAL placeholder
 *              artifacts (deterministic bytes, real sha256) under
 *              server/data/marketplace-artifacts/.
 *
 *              Idempotent: exits early when listings already exist.
 *
 * Usage: npm run seed:marketplace   (from server/)
 * @feature marketplace
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

// ============================================================================
// SELLERS
// ============================================================================

const DEV_USER_ID = 'dev-user-id';

interface SeedSeller {
  id: string;
  displayName: string;
  /** Historic credit grant so getTierForCredits() yields the mock tier. */
  tierCredits: number;
}

const SELLERS: Record<string, SeedSeller> = {
  roboticsLab: {
    id: 'seller-robotics-lab-berlin',
    displayName: 'Robotics Lab Berlin',
    tierCredits: 20000, // platinum
  },
  automate: {
    id: 'seller-automate-gmbh',
    displayName: 'AutoMate GmbH',
    tierCredits: 5000, // gold
  },
  tuMunich: {
    id: 'seller-tu-munich',
    displayName: 'TU Munich Robotics',
    tierCredits: 100000, // diamond
  },
  graspAI: {
    id: 'seller-graspai',
    displayName: 'GraspAI',
    tierCredits: 1000, // silver
  },
  factoryBot: {
    id: 'seller-factorybot',
    displayName: 'FactoryBot Solutions',
    tierCredits: 5000, // gold
  },
  openRobotics: {
    id: 'seller-open-robotics',
    displayName: 'Open Robotics Collective',
    tierCredits: 20000, // platinum
  },
};

// ============================================================================
// LISTINGS (ported verbatim from the app mock data)
// ============================================================================

interface SeedPriceTier {
  tier: string;
  label: string;
  description: string;
  priceCredits: number;
  features: string[];
}

interface SeedReview {
  id: string;
  authorName: string;
  authorTier: string;
  rating: number;
  body: string;
  createdAt: string;
  robotType: string;
}

interface SeedListing {
  id: string;
  type: 'skill' | 'dataset';
  title: string;
  shortDescription: string;
  fullDescription: string;
  /** Actual seller account id (ml-002/ml-006 belong to dev-user-id). */
  sellerId: string;
  /** Denormalized display name (stays the mock brand for dev-user listings). */
  sellerName: string;
  robotType: string;
  baseModel: string;
  tags: string[];
  rating: number;
  reviewCount: number;
  downloadCount: number;
  isTrending: boolean;
  isFeatured: boolean;
  taskCategory?: string;
  successRate?: number;
  adapterSizeMB?: number;
  episodeCount?: number;
  frameCount?: number;
  datasetSizeGB?: number;
  collectionMethod?: string;
  priceTiers: SeedPriceTier[];
  createdAt: string;
  reviews: SeedReview[];
}

const LISTINGS: SeedListing[] = [
  {
    id: 'ml-001',
    type: 'skill',
    title: 'Precise Grasping — Table Objects',
    shortDescription: 'LoRA adapter for reliable pick-and-place of everyday objects from flat surfaces. 94% success rate on SO-101.',
    fullDescription: `Fine-tuned SmolVLA adapter trained on 2,400 real-world grasping episodes. Handles cups, bottles, boxes, and tools on table surfaces.\n\nTrained with kinesthetic demonstrations on SO-101 hardware. The adapter adds precise wrist orientation control that the base model lacks for small objects.\n\nIncludes dataset statistics and evaluation metrics. Tested across 5 different lighting conditions and 3 table heights.`,
    sellerId: SELLERS.roboticsLab.id,
    sellerName: SELLERS.roboticsLab.displayName,
    robotType: 'SO-101',
    baseModel: 'SmolVLA',
    tags: ['grasping', 'pick-and-place', 'tabletop', 'manipulation'],
    rating: 4.8,
    reviewCount: 47,
    downloadCount: 1243,
    isTrending: false,
    isFeatured: true,
    taskCategory: 'Manipulation',
    successRate: 94,
    adapterSizeMB: 142,
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial use only', priceCredits: 200, features: ['Single user', 'Research only', 'No redistribution'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'One robot instance', priceCredits: 800, features: ['1 robot license', 'Commercial use', 'Email support'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Unlimited robots in one org', priceCredits: 2400, features: ['Unlimited robots', 'Commercial use', 'Priority support'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Unlimited + redistribution', priceCredits: 8000, features: ['Unlimited robots', 'Redistribution rights', 'SLA support', 'Custom fine-tuning'] },
    ],
    createdAt: '2026-03-15',
    reviews: [
      { id: 'r1', authorName: 'Dr. Schmidt', authorTier: 'gold', rating: 5, body: 'Excellent adapter. Works out of the box on our SO-101 setup. The grasping precision is remarkably better than base SmolVLA.', createdAt: '2026-04-01', robotType: 'SO-101' },
      { id: 'r2', authorName: 'RoboTest Lab', authorTier: 'silver', rating: 4, body: 'Good results on standard objects. Struggles slightly with transparent items but overall very reliable.', createdAt: '2026-03-28', robotType: 'SO-101' },
      { id: 'r3', authorName: 'Maker Space HH', authorTier: 'bronze', rating: 5, body: 'Genau was wir gebraucht haben. Sofort einsatzbereit.', createdAt: '2026-03-20', robotType: 'SO-101' },
    ],
  },
  {
    id: 'ml-002',
    type: 'skill',
    title: 'Pick & Stack — Warehouse Pallets',
    shortDescription: 'Industrial pallet stacking skill for Unitree H1. Handles standard EUR pallets and cardboard boxes.',
    fullDescription: `Production-grade LoRA adapter for warehouse pallet operations. Trained on 5,000+ episodes in real warehouse environments.\n\nSupports EUR pallet dimensions, various box sizes (small parcel to large carton), and multi-layer stacking patterns.\n\nRequires Pi0.5 base model. Optimized for the H1's full-body coordination during heavy lifting sequences.`,
    sellerId: DEV_USER_ID, // dev-user listing so "My Listings" is populated
    sellerName: SELLERS.factoryBot.displayName,
    robotType: 'Unitree H1',
    baseModel: 'Pi0.5',
    tags: ['warehouse', 'stacking', 'pallets', 'logistics', 'industrial'],
    rating: 4.6,
    reviewCount: 23,
    downloadCount: 567,
    isTrending: true,
    isFeatured: false,
    taskCategory: 'Logistics',
    successRate: 89,
    adapterSizeMB: 198,
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial use only', priceCredits: 350, features: ['Single user', 'Research only', 'No redistribution'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'One robot instance', priceCredits: 1200, features: ['1 robot license', 'Commercial use', 'Email support'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Unlimited robots in one org', priceCredits: 4000, features: ['Unlimited robots', 'Commercial use', 'Priority support'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Unlimited + redistribution', priceCredits: 12000, features: ['Unlimited robots', 'Redistribution rights', 'SLA support', 'Custom fine-tuning'] },
    ],
    createdAt: '2026-02-20',
    reviews: [
      { id: 'r4', authorName: 'LogiTech AG', authorTier: 'platinum', rating: 5, body: 'Running this on 12 H1 units in our fulfillment center. Reliable and fast. ROI within 3 months.', createdAt: '2026-03-15', robotType: 'Unitree H1' },
      { id: 'r5', authorName: 'WareBot Team', authorTier: 'gold', rating: 4, body: 'Great for standard boxes. Had to supplement with custom training for oddly-shaped packages.', createdAt: '2026-03-10', robotType: 'Unitree H1' },
    ],
  },
  {
    id: 'ml-003',
    type: 'dataset',
    title: 'SO-101 Kitchen Tasks — 480 Episodes',
    shortDescription: 'Diverse kitchen manipulation dataset: pouring, stirring, cutting, plate handling. LeRobot v3 format.',
    fullDescription: `High-quality kitchen task dataset recorded with kinesthetic teaching on SO-101.\n\n480 episodes across 8 task types: pouring liquids, stirring, cutting soft foods, plate pickup, bowl manipulation, utensil sorting, container opening, and wiping.\n\nRecorded in 3 different kitchen environments with varying lighting. Includes front and wrist camera views. All episodes quality-checked with >85% completion score.`,
    sellerId: SELLERS.tuMunich.id,
    sellerName: SELLERS.tuMunich.displayName,
    robotType: 'SO-101',
    baseModel: 'None',
    tags: ['kitchen', 'manipulation', 'pouring', 'cutting', 'household'],
    rating: 4.9,
    reviewCount: 62,
    downloadCount: 2100,
    isTrending: false,
    isFeatured: true,
    episodeCount: 480,
    frameCount: 576000,
    datasetSizeGB: 12.4,
    collectionMethod: 'Kinesthetic teaching',
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial use only', priceCredits: 150, features: ['Research use', 'Citation required', 'No redistribution'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'Train models for one robot', priceCredits: 500, features: ['Commercial training', 'One deployment target', 'Email support'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Train for unlimited robots', priceCredits: 1500, features: ['Commercial training', 'Unlimited deployments', 'Priority support'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Full rights + redistribution', priceCredits: 5000, features: ['Full rights', 'Redistribution', 'SLA support', 'Raw annotations'] },
    ],
    createdAt: '2026-01-10',
    reviews: [
      { id: 'r6', authorName: 'KI-Küche Lab', authorTier: 'gold', rating: 5, body: 'Beste Küchenmanipulations-Daten die wir gefunden haben. Exzellente Qualität und Vielfalt.', createdAt: '2026-03-05', robotType: 'SO-101' },
      { id: 'r7', authorName: 'HomeBotIQ', authorTier: 'silver', rating: 5, body: 'Trained a LoRA on this dataset alone and got 91% success rate on pouring tasks. Amazing quality.', createdAt: '2026-02-28', robotType: 'SO-101' },
    ],
  },
  {
    id: 'ml-004',
    type: 'skill',
    title: 'Drawer Open/Close — Office Furniture',
    shortDescription: 'Handle detection and drawer manipulation for standard office furniture. Works with various handle types.',
    fullDescription: `Versatile drawer manipulation adapter that handles pull handles, knob handles, and recessed grips.\n\nTrained on 1,800 episodes covering filing cabinets, desk drawers, and storage units. Uses vision-based handle detection — no prior knowledge of furniture layout needed.\n\nWorks on any robot with a parallel gripper. Tested on SO-101 and adapted Generic profiles.`,
    sellerId: SELLERS.graspAI.id,
    sellerName: SELLERS.graspAI.displayName,
    robotType: 'Generic',
    baseModel: 'SmolVLA',
    tags: ['drawers', 'office', 'handles', 'furniture', 'manipulation'],
    rating: 4.3,
    reviewCount: 15,
    downloadCount: 312,
    isTrending: false,
    isFeatured: false,
    taskCategory: 'Manipulation',
    successRate: 87,
    adapterSizeMB: 128,
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial use only', priceCredits: 180, features: ['Single user', 'Research only', 'No redistribution'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'One robot instance', priceCredits: 650, features: ['1 robot license', 'Commercial use', 'Email support'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Unlimited robots in one org', priceCredits: 2000, features: ['Unlimited robots', 'Commercial use', 'Priority support'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Unlimited + redistribution', priceCredits: 6500, features: ['Unlimited robots', 'Redistribution rights', 'SLA support'] },
    ],
    createdAt: '2026-03-01',
    reviews: [
      { id: 'r8', authorName: 'Office Automation Inc', authorTier: 'silver', rating: 4, body: 'Works well with standard IKEA furniture. Some issues with very old wooden cabinets but overall solid.', createdAt: '2026-03-25', robotType: 'Generic' },
    ],
  },
  {
    id: 'ml-005',
    type: 'dataset',
    title: 'H1 Bipedal Navigation — 320 Episodes',
    shortDescription: 'Indoor navigation dataset for Unitree H1: corridors, doorways, obstacles, and uneven surfaces.',
    fullDescription: `Navigation dataset for bipedal robots in real indoor environments.\n\n320 episodes covering office corridors, doorway passages, obstacle avoidance, ramp traversal, and carpet-to-tile transitions.\n\nRecorded with autonomous policy + human corrections. Includes LIDAR, IMU, and camera data streams in LeRobot v3 format.`,
    sellerId: SELLERS.openRobotics.id,
    sellerName: SELLERS.openRobotics.displayName,
    robotType: 'Unitree H1',
    baseModel: 'None',
    tags: ['navigation', 'bipedal', 'indoor', 'obstacles', 'locomotion'],
    rating: 4.7,
    reviewCount: 34,
    downloadCount: 890,
    isTrending: true,
    isFeatured: false,
    episodeCount: 320,
    frameCount: 384000,
    datasetSizeGB: 28.6,
    collectionMethod: 'Autonomous + corrections',
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial use only', priceCredits: 250, features: ['Research use', 'Citation required', 'No redistribution'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'Train for one robot', priceCredits: 900, features: ['Commercial training', 'One deployment target'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Train for unlimited robots', priceCredits: 2800, features: ['Commercial training', 'Unlimited deployments', 'Priority support'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Full rights', priceCredits: 9000, features: ['Full rights', 'Redistribution', 'SLA support'] },
    ],
    createdAt: '2026-02-05',
    reviews: [
      { id: 'r9', authorName: 'WalkBot Research', authorTier: 'gold', rating: 5, body: 'Excellent quality. The human correction annotations are incredibly valuable for training stable gaits.', createdAt: '2026-03-18', robotType: 'Unitree H1' },
      { id: 'r10', authorName: 'BipedalAI', authorTier: 'silver', rating: 4, body: 'Good variety of environments. Would love to see outdoor data in a future version.', createdAt: '2026-03-12', robotType: 'Unitree H1' },
    ],
  },
  {
    id: 'ml-006',
    type: 'skill',
    title: 'Bottle Uncapping Sequence',
    shortDescription: 'Two-hand coordination for opening screw-cap bottles. Trained on SO-101 dual-arm setup.',
    fullDescription: `Specialized adapter for bottle opening tasks requiring bimanual coordination.\n\nThe skill coordinates hold-and-twist motions using SO-101's dual arm configuration. Handles standard water bottles, soda bottles, and jar lids up to 8cm diameter.\n\n1,200 training episodes with Pi0.5 base model. Includes force-feedback data for torque-sensitive cap removal.`,
    sellerId: DEV_USER_ID, // dev-user listing so "My Listings" is populated
    sellerName: SELLERS.automate.displayName,
    robotType: 'SO-101',
    baseModel: 'Pi0.5',
    tags: ['bimanual', 'bottles', 'opening', 'coordination', 'dexterous'],
    rating: 4.4,
    reviewCount: 19,
    downloadCount: 445,
    isTrending: false,
    isFeatured: false,
    taskCategory: 'Dexterous Manipulation',
    successRate: 82,
    adapterSizeMB: 167,
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial use only', priceCredits: 220, features: ['Single user', 'Research only'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'One robot instance', priceCredits: 750, features: ['1 robot license', 'Commercial use'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Unlimited robots', priceCredits: 2200, features: ['Unlimited robots', 'Commercial use', 'Priority support'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Full rights', priceCredits: 7000, features: ['Unlimited', 'Redistribution', 'SLA'] },
    ],
    createdAt: '2026-03-08',
    reviews: [
      { id: 'r11', authorName: 'DualArm Lab', authorTier: 'gold', rating: 5, body: 'Finally a bimanual skill that actually works! The coordination is smooth and reliable.', createdAt: '2026-04-02', robotType: 'SO-101' },
    ],
  },
  {
    id: 'ml-007',
    type: 'dataset',
    title: 'Generic Arm Pick Dataset — 1,200 Episodes',
    shortDescription: 'Large-scale pick-and-place dataset across 50 object categories. Robot-agnostic action format.',
    fullDescription: `Massive pick-and-place dataset designed to be robot-agnostic.\n\n1,200 episodes covering 50 object categories from household items to industrial parts. Recorded using teleoperation on multiple arm platforms and normalized to a generic action space.\n\nIdeal as a pre-training dataset for fine-tuning on specific hardware. Includes object segmentation masks and grasp annotations.`,
    sellerId: SELLERS.tuMunich.id,
    sellerName: SELLERS.tuMunich.displayName,
    robotType: 'Generic',
    baseModel: 'None',
    tags: ['pick-and-place', 'large-scale', 'multi-object', 'generic', 'pre-training'],
    rating: 4.8,
    reviewCount: 78,
    downloadCount: 3400,
    isTrending: false,
    isFeatured: false,
    episodeCount: 1200,
    frameCount: 1440000,
    datasetSizeGB: 45.2,
    collectionMethod: 'Teleoperation',
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial', priceCredits: 300, features: ['Research use', 'Citation required'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'Train for one robot', priceCredits: 1000, features: ['Commercial training', 'One deployment'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Unlimited robots', priceCredits: 3500, features: ['Commercial training', 'Unlimited deployments'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Full rights', priceCredits: 10000, features: ['Full rights', 'Redistribution', 'Annotations'] },
    ],
    createdAt: '2025-12-15',
    reviews: [
      { id: 'r12', authorName: 'Manipulation Lab ETH', authorTier: 'platinum', rating: 5, body: 'The gold standard for pre-training manipulation models. Used this as foundation for 3 different downstream tasks.', createdAt: '2026-02-10', robotType: 'Generic' },
      { id: 'r13', authorName: 'StartupBot', authorTier: 'bronze', rating: 5, body: 'Incredible value. Saved us months of data collection.', createdAt: '2026-01-25', robotType: 'SO-101' },
    ],
  },
  {
    id: 'ml-008',
    type: 'skill',
    title: 'Cable Routing — Electronics Assembly',
    shortDescription: 'Deformable object manipulation for routing cables through PCB assemblies. High precision required.',
    fullDescription: `Specialized adapter for deformable linear object (DLO) manipulation in electronics assembly contexts.\n\nHandles cable routing through clips, around components, and into connectors. The skill uses vision-based cable tracking to adapt to varying cable stiffness.\n\n800 training episodes on SO-101 with SmolVLA base. Includes safety constraints to prevent component damage.`,
    sellerId: SELLERS.factoryBot.id,
    sellerName: SELLERS.factoryBot.displayName,
    robotType: 'SO-101',
    baseModel: 'SmolVLA',
    tags: ['cables', 'assembly', 'deformable', 'electronics', 'precision'],
    rating: 4.5,
    reviewCount: 11,
    downloadCount: 189,
    isTrending: true,
    isFeatured: false,
    taskCategory: 'Assembly',
    successRate: 79,
    adapterSizeMB: 155,
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial', priceCredits: 280, features: ['Single user', 'Research only'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'One robot', priceCredits: 950, features: ['1 robot license', 'Commercial use'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Unlimited robots', priceCredits: 3000, features: ['Unlimited robots', 'Priority support'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Full rights', priceCredits: 9500, features: ['Unlimited', 'Redistribution', 'SLA'] },
    ],
    createdAt: '2026-03-22',
    reviews: [
      { id: 'r14', authorName: 'EMS Factory', authorTier: 'gold', rating: 5, body: 'Game changer for our cable routing station. Reduced manual intervention by 70%.', createdAt: '2026-04-05', robotType: 'SO-101' },
    ],
  },
  {
    id: 'ml-009',
    type: 'skill',
    title: 'Door Handle Interaction Pack',
    shortDescription: 'Lever and knob handle operation for doors, cabinets, and panels. Universal gripper compatible.',
    fullDescription: `Versatile door interaction skill covering lever handles, round knobs, push bars, and sliding doors.\n\nTrained on 2,000 episodes across office, residential, and industrial door types. Uses Pi0.5 base model for full-body planning on humanoid platforms.\n\nIncludes force-aware grasping to prevent handle damage and adaptive approach planning for different door configurations.`,
    sellerId: SELLERS.openRobotics.id,
    sellerName: SELLERS.openRobotics.displayName,
    robotType: 'Generic',
    baseModel: 'Pi0.5',
    tags: ['doors', 'handles', 'interaction', 'navigation', 'service'],
    rating: 4.6,
    reviewCount: 28,
    downloadCount: 723,
    isTrending: false,
    isFeatured: false,
    taskCategory: 'Interaction',
    successRate: 91,
    adapterSizeMB: 175,
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial', priceCredits: 200, features: ['Single user', 'Research only'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'One robot', priceCredits: 700, features: ['1 robot license', 'Commercial use'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Unlimited robots', priceCredits: 2200, features: ['Unlimited robots', 'Priority support'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Full rights', priceCredits: 7500, features: ['Unlimited', 'Redistribution', 'SLA'] },
    ],
    createdAt: '2026-02-14',
    reviews: [
      { id: 'r15', authorName: 'ServiceBot Co', authorTier: 'gold', rating: 5, body: 'Works on every door type in our office building. Lever handles, fire doors, everything.', createdAt: '2026-03-20', robotType: 'Unitree H1' },
      { id: 'r16', authorName: 'Home Assistant Lab', authorTier: 'silver', rating: 4, body: 'Good general-purpose skill. Round knobs are trickier than levers but still decent success rate.', createdAt: '2026-03-08', robotType: 'Generic' },
    ],
  },
  {
    id: 'ml-010',
    type: 'dataset',
    title: 'H1 Stair Climbing — 90 Episodes',
    shortDescription: 'Challenging bipedal locomotion dataset: stairs up/down, varying step heights, handrail interaction.',
    fullDescription: `Specialized stair climbing dataset for humanoid robots.\n\n90 carefully curated episodes of stair ascent and descent. Covers standard staircases (17-20cm steps), steep industrial stairs, and spiral staircases.\n\nIncludes optional handrail grasping episodes. Recorded with motion capture ground truth for precise foot placement evaluation. IMU, joint encoders, and stereo camera data included.`,
    sellerId: SELLERS.openRobotics.id,
    sellerName: SELLERS.openRobotics.displayName,
    robotType: 'Unitree H1',
    baseModel: 'None',
    tags: ['stairs', 'locomotion', 'bipedal', 'climbing', 'balance'],
    rating: 4.5,
    reviewCount: 8,
    downloadCount: 156,
    isTrending: false,
    isFeatured: false,
    episodeCount: 90,
    frameCount: 216000,
    datasetSizeGB: 8.3,
    collectionMethod: 'Teleoperation + MoCap',
    priceTiers: [
      { tier: 'research', label: 'Research', description: 'Non-commercial', priceCredits: 400, features: ['Research use', 'Citation required', 'MoCap data included'] },
      { tier: 'per_robot', label: 'Per Robot', description: 'Train for one robot', priceCredits: 1500, features: ['Commercial training', 'MoCap data'] },
      { tier: 'per_fleet', label: 'Per Fleet', description: 'Unlimited robots', priceCredits: 4500, features: ['Commercial training', 'Unlimited', 'MoCap data'] },
      { tier: 'enterprise', label: 'Enterprise', description: 'Full rights', priceCredits: 15000, features: ['Full rights', 'Redistribution', 'Raw MoCap'] },
    ],
    createdAt: '2026-03-30',
    reviews: [
      { id: 'r17', authorName: 'Locomotion Lab', authorTier: 'platinum', rating: 5, body: 'The MoCap ground truth makes this invaluable. Only 90 episodes but each one is gold.', createdAt: '2026-04-08', robotType: 'Unitree H1' },
    ],
  },
];

// ============================================================================
// SEEDED PURCHASES
// ============================================================================

/** Dev-user purchases matching the old mock (MOCK_MY_PURCHASES). */
const DEV_PURCHASES = [
  { id: 'mp-001', listingId: 'ml-001', tier: 'per_robot', creditsPaid: 800, purchasedAt: '2026-04-02' },
  { id: 'mp-002', listingId: 'ml-003', tier: 'research', creditsPaid: 150, purchasedAt: '2026-03-18' },
  { id: 'mp-003', listingId: 'ml-005', tier: 'per_fleet', creditsPaid: 2800, purchasedAt: '2026-03-25' },
];

/**
 * Fake-buyer purchases on the two dev-user listings so "My Listings" shows
 * real revenue (ml-002 → 14400 matches the old mock exactly; ml-006 → 3700,
 * closest achievable to the mock's 3750 with 4 distinct demo buyers).
 */
const FAKE_BUYER_PURCHASES = [
  { buyerId: 'buyer-demo-1', listingId: 'ml-002', tier: 'enterprise', creditsPaid: 12000, purchasedAt: '2026-03-01' },
  { buyerId: 'buyer-demo-2', listingId: 'ml-002', tier: 'per_robot', creditsPaid: 1200, purchasedAt: '2026-03-20' },
  { buyerId: 'buyer-demo-3', listingId: 'ml-002', tier: 'per_robot', creditsPaid: 1200, purchasedAt: '2026-04-05' },
  { buyerId: 'buyer-demo-2', listingId: 'ml-006', tier: 'per_fleet', creditsPaid: 2200, purchasedAt: '2026-03-15' },
  { buyerId: 'buyer-demo-3', listingId: 'ml-006', tier: 'per_robot', creditsPaid: 750, purchasedAt: '2026-03-28' },
  { buyerId: 'buyer-demo-4', listingId: 'ml-006', tier: 'per_robot', creditsPaid: 750, purchasedAt: '2026-04-10' },
];

// ============================================================================
// ARTIFACT GENERATION (real files, real sha256)
// ============================================================================

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Deterministic pseudo-random bytes via chained sha256 (no Math.random). */
function deterministicBytes(seed: string, size: number): Buffer {
  const chunks: Buffer[] = [];
  let total = 0;
  let counter = 0;
  while (total < size) {
    const hash = createHash('sha256').update(`${seed}:${counter}`).digest();
    chunks.push(hash);
    total += hash.length;
    counter += 1;
  }
  return Buffer.concat(chunks, size);
}

interface GeneratedArtifact {
  fileName: string;
  artifactUri: string;
  sizeBytes: number;
  checksumSha256: string;
}

/** Write a real placeholder artifact and return its metadata. */
function generateArtifact(listing: SeedListing): GeneratedArtifact {
  const slug = slugify(listing.title) || listing.id;
  const dir = join(process.cwd(), 'data', 'marketplace-artifacts', listing.id);
  mkdirSync(dir, { recursive: true });

  let fileName: string;
  let content: Buffer;
  if (listing.type === 'skill') {
    fileName = `${slug}-adapter.safetensors`;
    content = deterministicBytes(listing.id, 256 * 1024); // 256 KB
  } else {
    fileName = `${slug}-lerobot-v3.tar.gz`;
    const metadata = {
      listingId: listing.id,
      title: listing.title,
      format: 'lerobot-v3',
      episodeCount: listing.episodeCount ?? 0,
      frameCount: listing.frameCount ?? 0,
      collectionMethod: listing.collectionMethod ?? 'unknown',
      robotType: listing.robotType,
      note: 'Placeholder marketplace artifact generated by seed-marketplace-demo.ts',
    };
    content = gzipSync(Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'));
  }

  const filePath = join(dir, fileName);
  writeFileSync(filePath, content);

  return {
    fileName,
    artifactUri: `local://marketplace-artifacts/${listing.id}/${fileName}`,
    sizeBytes: content.length,
    checksumSha256: createHash('sha256').update(content).digest('hex'),
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const existing = await prisma.marketplaceListing.count();
  if (existing > 0) {
    console.log(
      `[seed-marketplace] ${existing} listings already exist — nothing to do (idempotent exit).`
    );
    return;
  }

  // --- Listings + licenses + versions + reviews + artifacts -----------------
  const versionIdByListing = new Map<string, string>();
  const licenseIdByListingTier = new Map<string, string>();
  let reviewCounter = 0;

  for (const listing of LISTINGS) {
    await prisma.marketplaceListing.create({
      data: {
        id: listing.id,
        sellerId: listing.sellerId,
        sellerName: listing.sellerName,
        type: listing.type,
        title: listing.title,
        shortDescription: listing.shortDescription,
        fullDescription: listing.fullDescription,
        robotType: listing.robotType,
        baseModel: listing.baseModel,
        tags: JSON.stringify(listing.tags),
        status: 'published',
        isFeatured: listing.isFeatured,
        isTrending: listing.isTrending,
        downloadCount: listing.downloadCount,
        rating: listing.rating,
        reviewCount: listing.reviewCount,
        taskCategory: listing.taskCategory ?? null,
        successRate: listing.successRate ?? null,
        adapterSizeMB: listing.adapterSizeMB ?? null,
        episodeCount: listing.episodeCount ?? null,
        frameCount: listing.frameCount ?? null,
        datasetSizeGB: listing.datasetSizeGB ?? null,
        collectionMethod: listing.collectionMethod ?? null,
        createdAt: new Date(listing.createdAt),
        licenses: {
          create: listing.priceTiers.map((tier) => ({
            tier: tier.tier,
            label: tier.label,
            description: tier.description,
            priceCredits: tier.priceCredits,
            features: JSON.stringify(tier.features),
          })),
        },
      },
    });

    const licenses = await prisma.listingLicense.findMany({
      where: { listingId: listing.id },
    });
    for (const license of licenses) {
      licenseIdByListingTier.set(`${listing.id}:${license.tier}`, license.id);
    }

    const artifact = generateArtifact(listing);
    const version = await prisma.listingVersion.create({
      data: {
        listingId: listing.id,
        version: '1.0.0',
        artifactUri: artifact.artifactUri,
        fileName: artifact.fileName,
        fileSizeBytes: BigInt(artifact.sizeBytes),
        checksumSha256: artifact.checksumSha256,
        changelog: 'Initial release',
        createdAt: new Date(listing.createdAt),
      },
    });
    versionIdByListing.set(listing.id, version.id);

    for (const review of listing.reviews) {
      reviewCounter += 1;
      await prisma.listingReview.create({
        data: {
          id: review.id,
          listingId: listing.id,
          authorId: `reviewer-${reviewCounter}`,
          authorName: review.authorName,
          authorTier: review.authorTier,
          rating: review.rating,
          body: review.body,
          robotType: review.robotType,
          createdAt: new Date(review.createdAt),
        },
      });
    }

    console.log(
      `[seed-marketplace] ${listing.id} "${listing.title}" (${listing.type}) — ` +
        `${licenses.length} tiers, ${listing.reviews.length} reviews, ` +
        `artifact ${artifact.fileName} (${artifact.sizeBytes} bytes, sha256 ${artifact.checksumSha256.slice(0, 12)}…)`
    );
  }

  // --- Credit ledger: seller tier grants -------------------------------------
  for (const seller of Object.values(SELLERS)) {
    await prisma.contributionCredit.create({
      data: {
        userId: seller.id,
        amount: seller.tierCredits,
        reason: 'Historic marketplace sales (migrated)',
      },
    });
  }

  // --- Credit ledger: dev-user welcome grant ---------------------------------
  await prisma.contributionCredit.create({
    data: {
      userId: DEV_USER_ID,
      amount: 8550,
      reason: 'Welcome credit grant',
    },
  });

  // --- Dev-user purchases (matching old mock) + ledger rows -------------------
  const listingById = new Map(LISTINGS.map((l) => [l.id, l]));
  for (const purchase of DEV_PURCHASES) {
    const listing = listingById.get(purchase.listingId)!;
    const licenseId = licenseIdByListingTier.get(`${purchase.listingId}:${purchase.tier}`)!;
    await prisma.listingPurchase.create({
      data: {
        id: purchase.id,
        buyerId: DEV_USER_ID,
        listingId: purchase.listingId,
        licenseId,
        versionId: versionIdByListing.get(purchase.listingId) ?? null,
        creditsPaid: purchase.creditsPaid,
        purchasedAt: new Date(purchase.purchasedAt),
      },
    });
    await prisma.contributionCredit.create({
      data: {
        userId: DEV_USER_ID,
        amount: -purchase.creditsPaid,
        reason: `Marketplace purchase: ${listing.title}`,
        createdAt: new Date(purchase.purchasedAt),
      },
    });
    await prisma.contributionCredit.create({
      data: {
        userId: listing.sellerId,
        amount: purchase.creditsPaid,
        reason: `Marketplace sale: ${listing.title}`,
        createdAt: new Date(purchase.purchasedAt),
      },
    });
  }
  console.log(`[seed-marketplace] ${DEV_PURCHASES.length} dev-user purchases seeded`);

  // --- Fake-buyer purchases on dev-user listings (+ sale credits, no debits) --
  for (const purchase of FAKE_BUYER_PURCHASES) {
    const listing = listingById.get(purchase.listingId)!;
    const licenseId = licenseIdByListingTier.get(`${purchase.listingId}:${purchase.tier}`)!;
    await prisma.listingPurchase.create({
      data: {
        buyerId: purchase.buyerId,
        listingId: purchase.listingId,
        licenseId,
        versionId: versionIdByListing.get(purchase.listingId) ?? null,
        creditsPaid: purchase.creditsPaid,
        purchasedAt: new Date(purchase.purchasedAt),
      },
    });
    await prisma.contributionCredit.create({
      data: {
        userId: DEV_USER_ID,
        amount: purchase.creditsPaid,
        reason: `Marketplace sale: ${listing.title}`,
        createdAt: new Date(purchase.purchasedAt),
      },
    });
  }
  console.log(`[seed-marketplace] ${FAKE_BUYER_PURCHASES.length} fake-buyer purchases seeded`);

  // --- Summary ----------------------------------------------------------------
  const devBalance = await prisma.contributionCredit.aggregate({
    where: { userId: DEV_USER_ID },
    _sum: { amount: true },
  });
  console.log(
    `[seed-marketplace] Done: ${LISTINGS.length} listings, ${reviewCounter} reviews, ` +
      `${DEV_PURCHASES.length + FAKE_BUYER_PURCHASES.length} purchases. ` +
      `Dev-user balance: ${devBalance._sum.amount ?? 0} credits ` +
      `(8550 grant - 3750 purchases + 18100 sale revenue = 22900).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
