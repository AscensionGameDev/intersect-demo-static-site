import { readFileSync } from 'fs';
import * as path from 'path';

export type BranchName = 'main' | 'prerelease' | 'development';

export interface Branch {
    name: BranchName;
    version: string;
    banners: string[];
}

export interface SiteConfig {
    branches: Branch[];
}

const siteConfigPath = path.join(process.cwd(), 'config/config.site.json');
const siteConfig: SiteConfig = JSON.parse(readFileSync(siteConfigPath, 'utf-8'));

export const { branches } = siteConfig;

export const siteTitle = 'Intersect Demos';
