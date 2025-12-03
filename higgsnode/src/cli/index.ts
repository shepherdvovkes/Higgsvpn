#!/usr/bin/env node

import { Command } from 'commander';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { statusCommand } from './commands/status';
import { configCommand } from './commands/config';
import { diagnoseCommand } from './commands/diagnose';

const program = new Command();

program
  .name('higgsnode')
  .description('HiggsNode - Node application for Higgs.net decentralized VPN network')
  .version('1.0.0');

program
  .command('start')
  .description('Start the HiggsNode')
  .action(() => {
    startCommand().catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
  });

program
  .command('stop')
  .description('Stop the HiggsNode')
  .action(() => {
    stopCommand().catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
  });

program
  .command('status')
  .description('Show HiggsNode status')
  .action(() => {
    statusCommand().catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
  });

configCommand(program);
diagnoseCommand(program);

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

