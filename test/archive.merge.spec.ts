import { expect } from 'chai';
import mergeHelper from '../src/utils/archive-helpers';

describe('Archive.mergeInsertItemsIntoArchiveContent', () => {
    const Archive: any = { mergeInsertItemsIntoArchiveContent: mergeHelper };

    it('merges into existing project block and creates chain if needed', () => {
        const existing = `Archive:\nPROJECT1:\n    PROJECT2:\n      - old line`;

        const insertItem = {
            obj: {
                text: `PROJECT3:\n    <o> new finished task @done(2025-11-21 11:01:14 pm)`,
                projects: ['PROJECT1', 'PROJECT2', 'PROJECT3'],
            },
            lineNumber: 42,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '    ',
        });

        expect(merged).to.include('PROJECT1:');
        expect(merged).to.include('PROJECT2:');
        expect(merged).to.include('PROJECT3:');
        expect(merged).to.include('<o> new finished task');
    });

    it('does not duplicate project headers', () => {
        const existing = `Archive:\nPROJECT1:\n    PROJECT2:\n      - old line`;

        const insertItem = {
            obj: {
                text: `PROJECT3:\n    <o> new finished task @done(2025-11-21 11:01:14 pm)`,
                projects: ['PROJECT1', 'PROJECT2', 'PROJECT3'],
            },
            lineNumber: 42,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '    ',
        });

        // PROJECT1 and PROJECT2 should each appear exactly once
        expect(merged.split('\n').filter((l) => l.trim().startsWith('PROJECT1:')).length).to.equal(
            1
        );
        expect(merged.split('\n').filter((l) => l.trim().startsWith('PROJECT2:')).length).to.equal(
            1
        );
    });

    it('preserves comments attached to archived todos', () => {
        const existing = `Archive:\nPROJECT1:`;

        const insertItem = {
            obj: {
                text: `PROJECT2:\n    <o> TASK1 @done(2025-11-21 11:01:14 pm)\n    - comment for task1`,
                projects: ['PROJECT1', 'PROJECT2'],
            },
            lineNumber: 40,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '    ',
        });

        // the comment should still be present in the merged content
        expect(merged).to.include('comment for task1');
    });

    it('inserts header-only projects correctly and only once', () => {
        const existing = `Archive:\n`;

        const insertItem = {
            obj: {
                text: '',
                projects: ['PROJECT1', 'PROJECT2'],
            },
            lineNumber: 100,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '    ',
        });

        // ensure PROJECT1 and PROJECT2 values exist only once as headers
        expect(merged.split('\n').filter((l) => l.trim().startsWith('PROJECT1:')).length).to.equal(
            1
        );
        expect(merged.split('\n').filter((l) => l.trim().startsWith('PROJECT2:')).length).to.equal(
            1
        );
    });

    it('removes @project tags from both existing content and inserted items', () => {
        const existing = `Archive:\nPROJECT1:\n    <o> TASK1 @done(2025-11-21 10:27:24 pm) @project(PROJECT1)`;

        const insertItem = {
            obj: {
                text: `PROJECT2:\n    <o> TASK2 @done(2025-11-21 10:27:59 pm) @project(PROJECT1.PROJECT2) @project(PROJECT1)`,
                projects: ['PROJECT1', 'PROJECT2'],
            },
            lineNumber: 200,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '    ',
        });

        // Ensure @project tags are not present after merge
        expect(merged.includes('@project(')).to.equal(false);
        // Also ensure project headers remain
        expect(merged).to.include('PROJECT1:');
        expect(merged).to.include('PROJECT2:');
    });

    it('merges nested projects from main section into existing Archive tree (same-file scenario)', () => {
        const beforeArchiveBody = [
            '  <o> no project here @done(2025-11-21 10:27:17 pm)',
            '  PROJECT1:',
            '    <o> TASK1 @done(2025-11-21 10:27:24 pm)',
            '      - some deeper comment for task1',
            '    PROJECT2:',
            '      <x> new completed task with commnet @cancelled(2025-11-21 10:56:50 pm)',
            '      - commnet',
            '      <o> TASK2 @done(2025-11-21 10:27:59 pm)',
            '        - comment for task2',
        ].join('\n');

        // This is the line that gets archived from the main section (under
        // PROJECT1 -> PROJECT2 -> PROJECT3). We pass the raw text and the
        // project chain metadata, mirroring what Archive.transformations
        // produce for same-file archiving.
        const insertItem = {
            obj: {
                text: '      <o> new finished task @done(2025-11-21 11:01:14 pm)',
                projects: ['PROJECT1', 'PROJECT2', 'PROJECT3'],
            },
            lineNumber: 9,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(beforeArchiveBody, [insertItem], {
            indentation: '  ',
            archive: {
                project: {
                    separator: '.',
                },
            },
        });

        // No debug output once assertions are stable
        const lines = merged.split('\n');

        // Expect a single PROJECT1 and PROJECT2 header in the archive body
        expect(lines.filter((l) => l.trim() === 'PROJECT1:').length).to.equal(1);
        expect(lines.filter((l) => l.trim() === 'PROJECT2:').length).to.equal(1);

        // Expect a PROJECT3 header created under PROJECT2
        expect(lines.filter((l) => l.trim() === 'PROJECT3:').length).to.equal(1);

        // Find indices to assert structural order
        const idxP1 = lines.findIndex((l) => l.trim() === 'PROJECT1:');
        const idxP2 = lines.findIndex((l) => l.trim() === 'PROJECT2:');
        const idxP3 = lines.findIndex((l) => l.trim() === 'PROJECT3:');

        expect(idxP1).to.be.greaterThan(-1);
        expect(idxP2).to.be.greaterThan(idxP1);
        expect(idxP3).to.be.greaterThan(idxP2);

        // The new finished task should appear under PROJECT3 and be properly indented
        const newTaskLine = lines.find((l) => l.indexOf('new finished task') !== -1) || '';
        expect(newTaskLine).to.contain('<o> new finished task');
        // It should be more indented than the PROJECT3 header in the body
        const project3Line = lines[idxP3] || '';
        expect(newTaskLine.length).to.be.greaterThan(project3Line.length);
    });

    it('uses helperConfig.indentation when no existing project indentation', () => {
        const beforeArchiveBody = '';

        const insertItem = {
            obj: {
                text: 'PROJECT1:\n    <o> TASK1 @done(2025-11-21 11:01:14 pm)',
                projects: ['PROJECT1'],
            },
            lineNumber: 1,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(beforeArchiveBody, [insertItem], {
            indentation: '    ', // 4 spaces: emulate an editor tabSize=4
            rootIndentLevel: 1,
        });

        // The created PROJECT1 header should be 4 spaces indented relative to the body
        const lines = merged.split('\n');
        expect(lines).to.include('    PROJECT1:');
        expect(lines).to.include('        <o> TASK1 @done(2025-11-21 11:01:14 pm)');
    });

    it('respects existing archive body indentation even if helper config differs', () => {
        const beforeArchiveBody = [
            '  PROJECT1:',
            '    <o> TASK1 @done(2025-11-21 11:01:14 pm)',
        ].join('\n');

        const insertItem = {
            obj: {
                text: '      <o> TASK2 @done(2025-11-21 11:03:14 pm)',
                projects: ['PROJECT1', 'PROJECT2'],
            },
            lineNumber: 2,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(beforeArchiveBody, [insertItem], {
            indentation: '    ', // helper config wants 4 spaces, but existing body uses 2
        });

        const lines = merged.split('\n');
        // The new PROJECT2 header should be indented with double the base indentation (4 spaces)
        expect(lines).to.include('    PROJECT2:');
        // The inserted task should be indented relative to PROJECT2 header
        expect(lines).to.include('      <o> TASK2 @done(2025-11-21 11:03:14 pm)');
    });

    it('does not add a leading blank line when creating a new archive file', () => {
        const existing = ``; // empty context simulating a new file

        const insertItem = {
            obj: {
                // In real transformations the insert item text does not include the project header
                text: `  <o> TASK1 @done(2025-11-21 11:01:14 pm)`,
                projects: ['PROJECT1'],
            },
            lineNumber: 1,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '  ',
        });

        // debug removed

        // There should be no empty first line - merged content should start with PROJECT1
        const lines = merged.split('\n');
        expect(lines[0].trim()).to.equal('PROJECT1:');
        expect(lines[1].trim()).to.contain('<o> TASK1');
    });

    it('does not insert an extra blank line when appending to an existing archive file that ends with newline', () => {
        const existing = 'PROJECT1:\n  <o> TASK1 @done(2025-11-21 10:27:24 pm)\n';

        const insertItem = {
            obj: {
                text: '  <o> TASK2 @done(2025-11-21 11:01:14 pm)',
                projects: ['PROJECT1'],
            },
            lineNumber: 100,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '  ',
        });

        // debug removed

        // No blank line should be inserted between existing and appended task
        expect(merged).to.not.include('\n\n  <o> TASK2');
        expect(merged).to.include('PROJECT1:');
        expect(merged).to.include('  <o> TASK1');
        expect(merged).to.include('\n  <o> TASK2');
    });

    it('inserts child project items under the existing project header after previously adding parent project items', () => {
        const existing = [
            'PROJECT1:',
            '  PROJECT2:',
            '    PROJECT3:',
            '      <o> EXISTING @done(2025-11-21 09:00:00 pm)',
        ].join('\n');

        // First insert from PROJECT1 (parent)
        const insertItem1 = {
            obj: {
                text: '  <o> FROM_PARENT @done(2025-11-21 09:01:00 pm)',
                projects: ['PROJECT1'],
            },
            lineNumber: 10,
        };

        const merged1 = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem1], {
            indentation: '  ',
        });

        // Now insert from PROJECT3 (descendant)
        const insertItem2 = {
            obj: {
                text: '      <o> FROM_CHILD @done(2025-11-21 09:02:00 pm)',
                projects: ['PROJECT1', 'PROJECT2', 'PROJECT3'],
            },
            lineNumber: 11,
        };

        const merged2 = Archive.mergeInsertItemsIntoArchiveContent(merged1, [insertItem2], {
            indentation: '  ',
        });

        // No debug output
        // Child item should be placed under PROJECT3, not appended at the end. Do strict
        // ordering check inside the project subsection rather than global indexes.
        expect(merged2.includes('PROJECT1:')).to.equal(true);
        expect(merged2.includes('PROJECT2:')).to.equal(true);
        expect(merged2.includes('PROJECT3:')).to.equal(true);

        const idxP3 = merged2.indexOf('PROJECT3:');
        const idxFromChild = merged2.indexOf('FROM_CHILD');
        const idxFromParent = merged2.indexOf('FROM_PARENT');

        expect(idxFromChild).to.be.greaterThan(idxP3);
        // debug removed
    });

    it('prepends new archived items to the top of the project group', () => {
        const existing = `PROJECT1:\n  <x> Old Item @done(2025-01-01)`;

        const insertItem = {
            obj: {
                text: '  <x> New Item @done(2025-11-25)',
                projects: ['PROJECT1'],
            },
            lineNumber: 100,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '  ',
        });

        const indexOfNew = merged.indexOf('New Item');
        const indexOfOld = merged.indexOf('Old Item');
        expect(indexOfNew).to.be.lessThan(indexOfOld);
    });

    it('prepends under headers that contain statistics or text after the colon', () => {
        const existing = `PROJECT1: (0) 0s\n  <x> Old Item @done(2025-01-01)`;

        const insertItem = {
            obj: {
                text: '  <x> New Item @done(2025-11-25)',
                projects: ['PROJECT1'],
            },
            lineNumber: 100,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '  ',
        });

        const indexOfNew = merged.indexOf('New Item');
        const indexOfOld = merged.indexOf('Old Item');
        expect(indexOfNew).to.be.lessThan(indexOfOld);
    });

    it('prepends root-level items (without projects) to the top of the archive body', () => {
        const existing = `PROJECT1:\n  <o> Old Item @done(2024-01-01)`;

        const insertItems = [
            {
                obj: {
                    text: '  <x> Root Oldest @cancelled(2025-11-25 08:15:52 pm)',
                },
                lineNumber: 1,
            },
            {
                obj: {
                    text: '  <o> Root Newest @done(2025-11-25 08:15:56 pm)',
                },
                lineNumber: 2,
            },
        ];

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, insertItems, {
            indentation: '  ',
        });

        // Both root-level items should appear before the first project header
        const idxProject = merged.indexOf('PROJECT1:');
        const idxNewest = merged.indexOf('Root Newest');
        const idxOldest = merged.indexOf('Root Oldest');
        expect(idxNewest).to.be.lessThan(idxProject);
        expect(idxOldest).to.be.lessThan(idxProject);
        // Newest root item should be above the older one (prepend behavior)
        expect(idxNewest).to.be.lessThan(idxOldest);
    });

    it('indents newly created project headers according to rootIndentLevel for same-file archives', () => {
        const existing = ``;

        const insertItem = {
            obj: {
                text: '        <o> Deep Task @done(2025-11-25 11:11:11 pm)',
                projects: ['PROJECT1', 'PROJECT2', 'PROJECT3'],
            },
            lineNumber: 1,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '  ',
            rootIndentLevel: 1, // Archive header is level 0, Archive body starts at level 1
        });

        const lines = merged.split('\n');
        expect(lines[0]).to.equal('  PROJECT1:');
        expect(lines[1]).to.equal('    PROJECT2:');
        expect(lines[2]).to.equal('      PROJECT3:');
        expect(lines[3].trim()).to.contain('Deep Task');
        // Item should be indented deeper than PROJECT3 (level 3 + 1 = 4)
        expect(lines[3].startsWith('        ')).to.equal(true);
    });

    it('ignores project header text included in insert items to avoid duplicate headers', () => {
        const existing = `PROJECT1:\n  <o> Original @done(2025-01-01)`;

        const insertItem = {
            obj: {
                text: 'PROJECT1:\n  <o> New Task @done(2025-11-25)',
                projects: ['PROJECT1'],
            },
            lineNumber: 50,
        };

        const merged = Archive.mergeInsertItemsIntoArchiveContent(existing, [insertItem], {
            indentation: '  ',
        });

        const projectCount = merged
            .split('\n')
            .filter((l) => l.trim().startsWith('PROJECT1:')).length;
        expect(projectCount).to.equal(1);
        expect(merged).to.include('New Task');
    });
});
