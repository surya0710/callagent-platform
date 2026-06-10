import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateKnowledgeBaseEntryDto } from './dto/create-knowledge-base-entry.dto';
import { KnowledgeBaseQueryDto } from './dto/knowledge-base-query.dto';
import { KnowledgeRetrievalDto } from './dto/knowledge-retrieval.dto';
import { UpdateKnowledgeBaseEntryDto } from './dto/update-knowledge-base-entry.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

@ApiTags('Knowledge Base')
@ApiBearerAuth()
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly knowledgeRetrievalService: KnowledgeRetrievalService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_BASE_READ)
  @ApiOperation({ summary: 'List knowledge base entries' })
  findAll(@Query() query: KnowledgeBaseQueryDto) {
    return this.knowledgeBaseService.findAll(query);
  }

  @Post('retrieve')
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_BASE_READ)
  @ApiOperation({ summary: 'Retrieve relevant knowledge base entries (RAG)' })
  retrieve(@Body() dto: KnowledgeRetrievalDto) {
    return this.knowledgeRetrievalService.retrieve(dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_BASE_READ)
  @ApiOperation({ summary: 'Get knowledge base entry by ID' })
  findOne(@Param('id') id: string) {
    return this.knowledgeBaseService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_BASE_WRITE)
  @ApiOperation({ summary: 'Create knowledge base entry' })
  create(
    @Body() dto: CreateKnowledgeBaseEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.knowledgeBaseService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_BASE_WRITE)
  @ApiOperation({ summary: 'Update knowledge base entry' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeBaseEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.knowledgeBaseService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_BASE_WRITE)
  @ApiOperation({ summary: 'Delete knowledge base entry' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.knowledgeBaseService.remove(id, user.id);
  }
}
