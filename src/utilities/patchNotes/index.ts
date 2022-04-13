import { readFileSync } from 'fs';
import fetch, { RequestInfo, RequestInit } from 'node-fetch';
import * as path from 'path';
import { URL } from 'url';

import { BranchName } from '../../metadata';

interface TeamCityConfig {
    accessToken: string;
    server: string;
}

type BuildType = 'stable' | 'prerelease' | 'development';

interface BuildFilter {
    branch: BranchName;
    project: 'intersect';
    version: string;
}

export interface PatchNotesFilter {
    branch: BranchName;
    project: 'intersect';
    version: string;
}

interface BuildMetadata {
    id: number;
    branch: BranchName;
    date: string;
    number: number;
    type: BuildType; // buildTypeId
    version: string;
}

export interface FileChange {
    afterRevision: string;
    beforeRevision: string;
    changeType: string;
    file: string;
}

interface ChangeMetadata {
    id: number;
    commit: string; // version
    date: string;
    username: string;
    files?: FileChange[];
}

export interface Change extends ChangeMetadata {
    comment: string;
}

export interface Build extends BuildMetadata {
    changes: Change[];
}

const teamCityConfigPath = path.join(process.cwd(), 'config/config.teamCity.json');
const teamCityConfig: TeamCityConfig = JSON.parse(readFileSync(teamCityConfigPath, 'utf-8'));
const requestCache: Record<string, any> = {};

function parseVersionString(versionString: string): [string, string, string] {
    const [, prefix, build, suffix] = /v?((?:\d+\.??){3})(?:\.(\d+))?(-[^\s]+)?/.exec(versionString);
    return [prefix, build, suffix];
}

function toBuildType(branchName: BranchName): BuildType {
    switch (branchName) {
        case 'main': return 'stable';
        default: return branchName;
    }
}

async function fetchTeamCity(url: RequestInfo, init?: RequestInit, force = false): Promise<any | null> {
    const urlString = url.toString();
    if (!force && urlString in requestCache) {
        console.log(`CACHE HIT: ${urlString}`);
        return requestCache[urlString];
    }

    console.log(`CACHE MISS: ${urlString}`);

    const { accessToken, server } = teamCityConfig;

    const definedInit = init || {};
    const resolvedInit: RequestInit = {
        ...definedInit,
        headers: {
            accept: 'application/json',
            authorization: `Bearer ${accessToken}`,
            ...(definedInit.headers || {})
        }
    };

    const resolvedInfo = typeof url === 'string' ? new URL(url, server) : url;
    const response = await fetch(resolvedInfo, resolvedInit);
    if (!response.ok) {
        if (Number.parseInt(response.headers.get('content-length')) > 0) {
            console.error(`${response.status}: ${response.statusText} for ${url}\n${await response.text()}`);
        } else {
            console.error(`${response.status}: ${response.statusText} for ${url}`);
        }

        return null;
    }

    return response.json();
}

function getBuildListUrl({ branch, project, version }: BuildFilter): string {
    const buildType = toBuildType(branch);
    return `/app/rest/builds?locator=project:${project},buildType:${buildType},property:(name:intersect.version.prefix,value:${version})&fields=build:(id,number,buildTypeId,finishDate,properties:(property:(name,value)),changes:(change:(id,version,username,date,comment,files)))`;
}

async function getBuilds({ branch, project, version }: BuildFilter): Promise<Build[]> {
    const [versionPrefix, rawBuildNumber, versionSuffix] = parseVersionString(version);
    const buildNumber = Number.parseInt(rawBuildNumber);
    const url = getBuildListUrl({ branch, project, version: versionPrefix });
    const result = await fetchTeamCity(url);

    if (result === null) {
        return [];
    }

    const { build: builds } = <{ build: any[] }>result;
    return builds.map(({ id, buildTypeId: type, number: rawNumber, finishDate, properties: { property: properties }, changes: { change: changes } }) => {
        const number = Number.parseInt(rawNumber);
        const resolvedProperties = properties.reduce((aggregate, { name, value }) => {
            aggregate[name] = value;
            return aggregate;
        }, {});
        let version = resolvedProperties['intersect.version'];
        for (const { name, value } of properties) {
            version = version.replace(`%${name}%`, value);
        }
        version = version.replace('%build.counter%', number);
        return (<Build>{
            id,
            branch,
            changes: changes.map(({ id, comment, version: commit, date, files: { file: files }, username }) => (<Change>{
                id,
                comment,
                commit,
                date,
                files: files.map(file => (<FileChange>{
                    afterRevision: file['after-revision'],
                    beforeRevision: file['before-revision'],
                    changeType: file.changeType,
                    file: file.file
                })),
                username
            })),
            date: finishDate,
            number,
            type,
            version
        });
    }).filter(({ number, changes }, index, array) => {
        if (number > buildNumber) {
            return false;
        }

        if (changes.length !== 0) {
            return true;
        }

        const foundIndex = array.findIndex(build => build.number === number && build.changes.length > 0);
        return foundIndex === index || index === -1;
    });
}

export async function getPatchNotes({ branch, project, version }: PatchNotesFilter): Promise<Build[]> {
    const builds = await getBuilds({ branch, project, version });
    return builds;
}