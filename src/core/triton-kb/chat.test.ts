import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt, renderConfigCommand, renderFilesCommand,
  renderProjectCommand, renderDefaultsCommand, suggestFollowups, deterministicFallback,
} from './chat';
import { ProjectContext } from './types';

const ctx: ProjectContext = {
  name: 'DemoFlood', description: 'demo', crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84',
  inputFormat: 'BIN', outputFormat: 'ASC', inputDir: 'input', outputDir: 'output', buildDir: 'build',
  hasImportedLegacy: false,
};

describe('buildSystemPrompt', () => {
  it('always embeds the knowledge base', () => {
    expect(buildSystemPrompt()).toContain('courant');
    expect(buildSystemPrompt(ctx)).toContain('courant');
  });
  it('includes the project name only when a project context is given', () => {
    expect(buildSystemPrompt(ctx)).toContain('DemoFlood');
    expect(buildSystemPrompt()).not.toContain('DemoFlood');
  });
  it('states no project is open only when context is absent', () => {
    expect(buildSystemPrompt()).toMatch(/no triton project is currently open/i);
    expect(buildSystemPrompt(ctx)).not.toMatch(/no triton project is currently open/i);
  });
});

describe('renderConfigCommand', () => {
  it('renders full detail for a known variable', () => {
    const md = renderConfigCommand('courant');
    expect(md).toContain('courant');
    expect(md).toContain('0.5');
    expect(md).toMatch(/Miscellaneous Parameters/);
  });
  it('is case-insensitive', () => {
    expect(renderConfigCommand('COURANT')).toContain('courant');
  });
  it('lists all 9 sections when no argument is given', () => {
    const md = renderConfigCommand('');
    expect(md).toContain('Simulation Control');
    expect(md).toContain('Miscellaneous Parameters');
    expect(md).toContain('Surface Roughness');
  });
  it('reports unknown variables with the full list', () => {
    const md = renderConfigCommand('nope');
    expect(md).toMatch(/unknown config variable/i);
    expect(md).toContain('courant');
  });
});

describe('renderFilesCommand', () => {
  it('groups file types by category when no argument is given', () => {
    const md = renderFilesCommand('');
    expect(md).toContain('input raster');
    expect(md).toContain('output raster');
    expect(md).toContain('esri-ascii-dem');
  });
  it('renders one file type by id', () => {
    const md = renderFilesCommand('esri-ascii-dem');
    expect(md).toContain('ESRI ASCII');
    expect(md).toContain('dem_filename');
  });
  it('reports unknown ids with the full list', () => {
    const md = renderFilesCommand('nope');
    expect(md).toMatch(/unknown file type/i);
    expect(md).toContain('esri-ascii-dem');
  });
});

describe('renderProjectCommand', () => {
  it('renders the project block when context is present', () => {
    expect(renderProjectCommand(ctx)).toContain('DemoFlood');
  });
  it('reports no project when context is absent', () => {
    expect(renderProjectCommand()).toMatch(/no triton project is open/i);
  });
});

describe('renderDefaultsCommand', () => {
  it('lists template defaults and the 5 conflicts', () => {
    const md = renderDefaultsCommand();
    expect(md).toMatch(/template-vs-ui conflicts/i);
    for (const name of ['time_step', 'print_observation', 'input_format', 'factor_interval_domain_decomposition', 'open_boundaries']) {
      expect(md).toContain(name);
    }
    expect(md).toContain('reference UI default');
    expect(md).toContain('0.01'); // time_step's reference-UI value (appears nowhere else in defaults)
  });
});

describe('suggestFollowups', () => {
  it('returns a small non-empty set that varies with project presence', () => {
    expect(suggestFollowups(undefined).length).toBeGreaterThan(0);
    expect(suggestFollowups(undefined).length).toBeLessThanOrEqual(4);
    expect(suggestFollowups(undefined, ctx)).not.toEqual(suggestFollowups(undefined));
  });
  it('routes the /config command to config-specific suggestions', () => {
    const followups = suggestFollowups('config');
    expect(followups).toContain('/config courant');
    expect(followups.length).toBeLessThanOrEqual(4);
  });
  it('routes the /files command to file-specific suggestions', () => {
    const followups = suggestFollowups('files');
    expect(followups).toContain('/files esri-ascii-dem');
    expect(followups.length).toBeLessThanOrEqual(4);
  });
  it('prefers command routing over project context', () => {
    expect(suggestFollowups('config', ctx)).toEqual(suggestFollowups('config'));
    expect(suggestFollowups('files', ctx)).toEqual(suggestFollowups('files'));
  });
});

describe('deterministicFallback', () => {
  it('renders a known variable entry', () => {
    expect(deterministicFallback('courant')).toContain('courant');
  });
  it('points at slash commands when nothing matches', () => {
    const md = deterministicFallback('how do I run a flood sim');
    expect(md).toMatch(/\/config/);
    expect(md).toMatch(/no language model/i);
  });
});
