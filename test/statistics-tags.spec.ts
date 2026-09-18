import { expect } from 'chai';

class Tag {
  constructor(
    public lineNumber: number,
    public text: string
  ) {}
}
class TodoBox {
  line = { text: '' };
  level = 1;

  constructor(public lineNumber: number) {}
}
class TodoDone {
  line = { text: '' };
  level = 1;

  constructor(public lineNumber: number) {}
}
class TodoCancelled {
  line = { text: '' };
  level = 1;

  constructor(public lineNumber: number) {}
}
class Comment {}
class Project {
  line = { text: 'Project:' };
  level = 0;

  constructor(public lineNumber: number) {}
}

const loadSubjects = () => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    tokenPath = require.resolve('../src/utils/statistics_tokens'),
    statisticsPath = require.resolve('../src/utils/statistics'),
    previousTokens = require.cache[tokenPath],
    previousStatistics = require.cache[statisticsPath],
    config = {
      getKey: (key: string) => {
        if (key === 'timekeeping.estimate.format' || key === 'timekeeping.elapsed.format') {
          return 'short-compact';
        }
        if (key === 'hoursPerDay') return 24;
        if (key === 'manHoursPerDay') return 8;
        if (key === 'manDaysPerWeek') return 5;
        return undefined;
      },
    };

  try {
    NodeModule._load = (request, parent, isMain) => {
      if (request === '../config') return { default: config };
      if (request === './time') return { default: { diff: (value) => String(value) } };
      return originalLoad(request, parent, isMain);
    };
    delete require.cache[tokenPath];
    const Tokens = require(tokenPath).default;

    NodeModule._load = (request, parent, isMain) => {
      if (request === 'vscode') return {};
      if (request === '../config') return { default: config };
      if (request === '../consts') return { default: { regexes: {} } };
      if (request === '../todo/items') {
        return { Comment, Project, Tag, TodoBox, TodoDone, TodoCancelled };
      }
      if (request === './ast') return { default: { getLevel: () => 0 } };
      if (request === './estimate') return { getEstimateDuration: () => undefined };
      if (request === './statistics-condition') return { evaluateStatisticsCondition: () => true };
      if (request === './statistics_tokens') return { default: Tokens };
      return originalLoad(request, parent, isMain);
    };
    delete require.cache[statisticsPath];

    return { Statistics: require(statisticsPath).default, Tokens };
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[tokenPath];
    delete require.cache[statisticsPath];
    if (previousTokens) require.cache[tokenPath] = previousTokens;
    if (previousStatistics) require.cache[statisticsPath] = previousStatistics;
  }
};

describe('Tag statistics', () => {
  it('collects tag-scoped todo counts from the global statistics path', () => {
    const { Statistics } = loadSubjects(),
      items = {
        archive: undefined,
        comments: [],
        projects: [],
        todosBox: [new TodoBox(0)],
        todosDone: [new TodoDone(1)],
        todosCancelled: [new TodoCancelled(2)],
        tags: [
          new Tag(0, '@high(review)'),
          new Tag(0, '@frontend'),
          new Tag(1, '@high'),
          new Tag(1, '@backend'),
          new Tag(2, '@low'),
          new Tag(2, '@frontend'),
        ],
      };

    Statistics.tokens.updateGlobal(items);

    expect(Statistics.tokens.global.getTagMetric('high', 'all')).to.equal(2);
    expect(Statistics.tokens.global.getTagMetric('high', 'pending')).to.equal(1);
    expect(Statistics.tokens.global.getTagMetric('high&frontend', 'all')).to.equal(1);
    expect(Statistics.tokens.global.getTagMetric('backend|low', 'all')).to.equal(2);
    expect(Statistics.tokens.global.getTagMetric('@frontend', 'cancelled')).to.equal(1);
  });

  it('aggregates time values for selected tags without double-counting OR matches', () => {
    const { Tokens } = loadSubjects(),
      first = new Tokens(),
      second = new Tokens(),
      root = new Tokens();

    first.pending = 1;
    first.tagNames = ['high', 'frontend'];
    first.estSeconds = 60;
    first.estTotalSeconds = 60;
    first.lastedSeconds = 10;

    second.done = 1;
    second.tagNames = ['high', 'backend'];
    second.estTotalSeconds = 120;
    second.lastedSeconds = 20;

    root.taggedTodos = [first, second];

    const selected = root.getTagTokens('high|frontend');

    expect(selected.all).to.equal(2);
    expect(selected.estSeconds).to.equal(60);
    expect(selected.estTotalSeconds).to.equal(180);
    expect(selected.lastedSeconds).to.equal(30);
  });

  it('makes tag-scoped metrics available to project statistics', () => {
    const { Statistics } = loadSubjects(),
      project = new Project(0),
      items = {
        archive: undefined,
        comments: [],
        projects: [project],
        todosBox: [new TodoBox(1)],
        todosDone: [new TodoDone(2)],
        todosCancelled: [],
        tags: [new Tag(1, '@high'), new Tag(2, '@low')],
      };

    Statistics.tokens.updateProjects({} as any, items);

    expect(Statistics.tokens.projects[0].getTagMetric('high', 'pending')).to.equal(1);
    expect(Statistics.tokens.projects[0].getTagMetric('low', 'done')).to.equal(1);
  });
});
